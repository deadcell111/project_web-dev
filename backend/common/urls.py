from django.urls import path
from common.views import presign_upload_view

urlpatterns = [
    path('uploads/presign/', presign_upload_view, name='presign-upload'),
]
