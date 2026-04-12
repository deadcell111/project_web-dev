from django.urls import path

from accounts.views import (
    UserProfileView,
    login_view,
    logout_view,
    refresh_view,
    register_view,
)

urlpatterns = [
    path('register/', register_view, name='register'),
    path('login/', login_view, name='login'),
    path('logout/', logout_view, name='logout'),
    path('refresh/', refresh_view, name='refresh'),
    path('me/', UserProfileView.as_view(), name='user-profile'),
]
