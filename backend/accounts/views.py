from django.middleware.csrf import get_token
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.serializers import LoginSerializer, ProfileSerializer, RegisterSerializer


def _set_auth_cookies(response, user):
    refresh = RefreshToken.for_user(user)
    access_token = str(refresh.access_token)
    refresh_token = str(refresh)

    response.set_cookie(
        'access_token',
        access_token,
        max_age=1800,
        httponly=True,
        samesite='Lax',
        path='/',
    )
    response.set_cookie(
        'refresh_token',
        refresh_token,
        max_age=604800,
        httponly=True,
        samesite='Lax',
        path='/api/auth/refresh/',
    )
    return response


def _user_data(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'telegram': getattr(user.profile, 'telegram', ''),
        'phone': getattr(user.profile, 'phone', ''),
        'avatar': getattr(user.profile, 'avatar', ''),
    }


@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    response = Response({'user': _user_data(user)}, status=status.HTTP_201_CREATED)
    _set_auth_cookies(response, user)
    get_token(request)
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data['user']
    response = Response({'user': _user_data(user)})
    _set_auth_cookies(response, user)
    get_token(request)
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    try:
        refresh_token = request.COOKIES.get('refresh_token')
        if refresh_token:
            token = RefreshToken(refresh_token)
            token.blacklist()
    except Exception:
        pass
    response = Response(status=status.HTTP_204_NO_CONTENT)
    response.delete_cookie('access_token', path='/')
    response.delete_cookie('refresh_token', path='/api/auth/refresh/')
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def refresh_view(request):
    refresh_token = request.COOKIES.get('refresh_token')
    if not refresh_token:
        return Response(
            {'detail': 'Refresh token not found.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    try:
        token = RefreshToken(refresh_token)
        new_access = str(token.access_token)
    except Exception:
        return Response(
            {'detail': 'Invalid or expired refresh token.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    response = Response({'detail': 'Token refreshed.'})
    response.set_cookie(
        'access_token',
        new_access,
        max_age=1800,
        httponly=True,
        samesite='Lax',
        path='/',
    )
    return response


class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(_user_data(request.user))

    def patch(self, request):
        user = request.user
        profile = user.profile

        for field in ('first_name', 'last_name'):
            if field in request.data:
                setattr(user, field, request.data[field])
        user.save()

        serializer = ProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(_user_data(user))
