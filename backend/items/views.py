from django.db.models import Count, Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from items.models import Category, Claim, Item
from items.serializers import CategorySerializer, ClaimSerializer, ItemSerializer


class ItemListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAuthenticated()]
        return [AllowAny()]

    def get(self, request):
        queryset = Item.objects.select_related('category', 'user').all()

        item_type = request.query_params.get('type')
        if item_type:
            queryset = queryset.filter(item_type=item_type)

        item_status = request.query_params.get('status')
        if item_status:
            queryset = queryset.filter(status=item_status)

        category = request.query_params.get('category')
        if category:
            queryset = queryset.filter(category_id=category)

        search = request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(description__icontains=search)
            )

        from rest_framework.pagination import PageNumberPagination
        paginator = PageNumberPagination()
        paginator.page_size = 20
        page = paginator.paginate_queryset(queryset, request)
        serializer = ItemSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        serializer = ItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'DELETE'])
def item_detail_view(request, pk):
    try:
        item = Item.objects.select_related('category', 'user').prefetch_related(
            'claims__user'
        ).get(pk=pk)
    except Item.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        serializer = ItemSerializer(item)
        return Response(serializer.data)

    if not request.user.is_authenticated or item.user != request.user:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )

    if request.method == 'PUT':
        serializer = ItemSerializer(item, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    if request.method == 'DELETE':
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyItemsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = Item.objects.filter(user=request.user).select_related(
            'category'
        ).prefetch_related('claims__user')
        serializer = ItemSerializer(items, many=True)
        return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_claim_view(request, pk):
    try:
        item = Item.objects.get(pk=pk)
    except Item.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if item.user == request.user:
        return Response(
            {'detail': 'Cannot claim your own item.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = ClaimSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(item=item, user=request.user)

    if item.status == Item.Status.OPEN:
        item.status = Item.Status.CLAIMED
        item.save(update_fields=['status'])

    return Response(serializer.data, status=status.HTTP_201_CREATED)


class ClaimListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            item = Item.objects.get(pk=pk)
        except Item.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if item.user != request.user:
            return Response(
                {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
            )

        claims = Claim.objects.filter(item=item).select_related('user')
        serializer = ClaimSerializer(claims, many=True)
        return Response(serializer.data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def approve_reject_view(request, pk, action):
    try:
        claim = Claim.objects.select_related('item').get(pk=pk)
    except Claim.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if claim.item.user != request.user:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )

    if action == 'approve':
        claim.status = Claim.Status.APPROVED
        claim.save(update_fields=['status'])
        claim.item.status = Item.Status.RESOLVED
        claim.item.save(update_fields=['status'])
    elif action == 'reject':
        claim.status = Claim.Status.REJECTED
        claim.save(update_fields=['status'])
        remaining = Claim.objects.filter(
            item=claim.item, status=Claim.Status.PENDING
        ).exists()
        if not remaining:
            claim.item.status = Item.Status.OPEN
            claim.item.save(update_fields=['status'])

    serializer = ClaimSerializer(claim)
    return Response(serializer.data)


class CategoryListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        categories = Category.objects.all()
        serializer = CategorySerializer(categories, many=True)
        return Response(serializer.data)


@api_view(['GET'])
@permission_classes([AllowAny])
def stats_view(request):
    total = Item.objects.count()
    open_items = Item.objects.filter(status=Item.Status.OPEN).count()
    resolved = Item.objects.filter(status=Item.Status.RESOLVED).count()
    lost_active = Item.objects.open_lost().count()
    return Response({
        'total_items': total,
        'open_items': open_items,
        'resolved_items': resolved,
        'lost_active': lost_active,
    })
