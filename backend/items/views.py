from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from common.storage import presign_get
from items.models import Category, Claim, Item
from items.serializers import CategorySerializer, ClaimSerializer, ItemSerializer
from notifications.models import Notification
from notifications.services import notify


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
        serializer = ItemSerializer(page, many=True, context={'request': request})
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        serializer = ItemSerializer(data=request.data, context={'request': request})
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
        serializer = ItemSerializer(item, context={'request': request})
        return Response(serializer.data)

    if not request.user.is_authenticated:
        return Response(
            {'detail': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED
        )
    is_owner = item.user == request.user
    is_admin = request.user.is_staff
    if request.method == 'PUT' and not is_owner:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
    if request.method == 'DELETE' and not (is_owner or is_admin):
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )

    if request.method == 'PUT':
        serializer = ItemSerializer(item, data=request.data, context={'request': request})
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
        serializer = ItemSerializer(items, many=True, context={'request': request})
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
    if item.status == Item.Status.RESOLVED:
        return Response(
            {'detail': 'Item is already resolved.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = ClaimSerializer(data=request.data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    try:
        claim = serializer.save(item=item, user=request.user)
    except IntegrityError:
        return Response(
            {'detail': 'You already have a pending claim on this item.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    notify(
        recipient=item.user,
        actor=request.user,
        kind=Notification.Kind.CLAIM_CREATED,
        item=item,
        claim=claim,
    )

    return Response(
        ClaimSerializer(claim, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


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
        serializer = ClaimSerializer(claims, many=True, context={'request': request})
        return Response(serializer.data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def approve_reject_view(request, pk, action):
    try:
        claim = Claim.objects.select_related('item', 'user').get(pk=pk)
    except Claim.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if claim.item.user != request.user:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
    if claim.status != Claim.Status.PENDING:
        return Response(
            {'detail': 'Claim is not pending.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if action == 'approve':
        with transaction.atomic():
            claim.status = Claim.Status.APPROVED
            claim.save(update_fields=['status'])
            claim.item.status = Item.Status.RESOLVED
            claim.item.save(update_fields=['status'])

            # Auto-reject remaining pending claims on this item
            other_pending = Claim.objects.filter(
                item=claim.item, status=Claim.Status.PENDING
            ).exclude(pk=claim.pk).select_related('user')
            for other in other_pending:
                other.status = Claim.Status.REJECTED
                other.save(update_fields=['status'])
                notify(
                    recipient=other.user,
                    actor=request.user,
                    kind=Notification.Kind.CLAIM_REJECTED,
                    item=claim.item,
                    claim=other,
                )

        notify(
            recipient=claim.user,
            actor=request.user,
            kind=Notification.Kind.CLAIM_APPROVED,
            item=claim.item,
            claim=claim,
        )

    elif action == 'reject':
        claim.status = Claim.Status.REJECTED
        claim.save(update_fields=['status'])
        # Item.status intentionally untouched
        notify(
            recipient=claim.user,
            actor=request.user,
            kind=Notification.Kind.CLAIM_REJECTED,
            item=claim.item,
            claim=claim,
        )

    else:
        return Response(
            {'detail': 'Invalid action.'}, status=status.HTTP_400_BAD_REQUEST
        )

    return Response(
        ClaimSerializer(claim, context={'request': request}).data
    )


class CategoryListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAdminUser()]
        return [AllowAny()]

    def get(self, request):
        categories = Category.objects.all()
        serializer = CategorySerializer(categories, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = CategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class CategoryDetailView(APIView):
    permission_classes = [IsAdminUser]

    def _get(self, pk):
        try:
            return Category.objects.get(pk=pk)
        except Category.DoesNotExist:
            return None

    def patch(self, request, pk):
        cat = self._get(pk)
        if cat is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = CategorySerializer(cat, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        cat = self._get(pk)
        if cat is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        cat.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def withdraw_claim_view(request, pk):
    try:
        claim = Claim.objects.select_related('item').get(pk=pk)
    except Claim.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if claim.user != request.user:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
    if claim.status != Claim.Status.PENDING:
        return Response(
            {'detail': 'Only pending claims can be withdrawn.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    item_owner = claim.item.user
    item = claim.item
    claim.delete()

    notify(
        recipient=item_owner,
        actor=request.user,
        kind=Notification.Kind.CLAIM_WITHDRAWN,
        item=item,
        claim=None,
    )

    return Response(status=status.HTTP_204_NO_CONTENT)


class MyClaimsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        claims = Claim.objects.filter(
            user=request.user
        ).select_related('item', 'item__category', 'item__user')
        data = ClaimSerializer(claims, many=True, context={'request': request}).data

        # Enrich with minimal item snapshot for the UI
        items_by_id = {c.item_id: c.item for c in claims}
        for row in data:
            item = items_by_id[row['item']]
            row['item_snapshot'] = {
                'id': item.id,
                'title': item.title,
                'item_type': item.item_type,
                'status': item.status,
                'image': presign_get(item.image),
            }
        return Response(data)


class AdminItemListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        qs = Item.objects.select_related('user', 'category').prefetch_related(
            'claims__user'
        )
        if (t := request.query_params.get('type')):
            qs = qs.filter(item_type=t)
        if (s := request.query_params.get('status')):
            qs = qs.filter(status=s)
        if (u := request.query_params.get('user_id')):
            qs = qs.filter(user_id=u)

        from rest_framework.pagination import PageNumberPagination
        paginator = PageNumberPagination()
        paginator.page_size = 20
        page = paginator.paginate_queryset(qs, request)
        serializer = ItemSerializer(page, many=True, context={'request': request})
        return paginator.get_paginated_response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def force_resolve_view(request, pk):
    try:
        item = Item.objects.get(pk=pk)
    except Item.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    if item.status == Item.Status.RESOLVED:
        return Response(
            {'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST
        )

    with transaction.atomic():
        item.status = Item.Status.RESOLVED
        item.save(update_fields=['status'])
        pending = Claim.objects.filter(
            item=item, status=Claim.Status.PENDING
        ).select_related('user')
        for c in pending:
            c.status = Claim.Status.REJECTED
            c.save(update_fields=['status'])
            notify(
                recipient=c.user,
                actor=request.user,
                kind=Notification.Kind.CLAIM_REJECTED,
                item=item,
                claim=c,
            )

    return Response(ItemSerializer(item, context={'request': request}).data)
