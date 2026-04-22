from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from common.storage import build_object_key, presign_put


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def presign_upload_view(request):
    kind = request.data.get('kind')
    content_type = request.data.get('content_type')

    if kind not in ('item', 'avatar'):
        return Response(
            {'detail': 'kind must be "item" or "avatar".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if content_type not in settings.UPLOAD_ALLOWED_CONTENT_TYPES:
        return Response(
            {'detail': f'content_type must be one of {settings.UPLOAD_ALLOWED_CONTENT_TYPES}.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    object_key = build_object_key(kind, content_type)
    upload_url = presign_put(object_key, content_type)
    return Response({
        'upload_url': upload_url,
        'object_key': object_key,
        'expires_in': settings.UPLOAD_PRESIGN_TTL,
    })
