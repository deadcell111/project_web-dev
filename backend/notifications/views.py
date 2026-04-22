from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.models import Notification
from notifications.serializers import NotificationSerializer


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = None  # custom shape

    def get(self, request):
        qs = Notification.objects.filter(
            recipient=request.user
        ).select_related('actor', 'item')

        unread_count = Notification.objects.filter(
            recipient=request.user, read_at__isnull=True
        ).count()

        if request.query_params.get('unread_only') == 'true':
            qs = qs.filter(read_at__isnull=True)

        try:
            limit = int(request.query_params.get('limit', 20))
        except ValueError:
            limit = 20
        limit = max(1, min(limit, 100))

        results = NotificationSerializer(qs[:limit], many=True).data
        return Response({
            'results': results,
            'unread_count': unread_count,
        })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def mark_read_view(request, pk):
    try:
        n = Notification.objects.get(pk=pk, recipient=request.user)
    except Notification.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    if n.read_at is None:
        n.read_at = timezone.now()
        n.save(update_fields=['read_at'])
    return Response(NotificationSerializer(n).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_all_read_view(request):
    Notification.objects.filter(
        recipient=request.user, read_at__isnull=True
    ).update(read_at=timezone.now())
    return Response({'unread_count': 0})
