from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/', include('items.urls')),
    path('api/', include('common.urls')),
    path('api/notifications/', include('notifications.urls')),
]
