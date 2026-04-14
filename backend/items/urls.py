from django.urls import path

from items.views import (
    CategoryListView,
    ClaimListView,
    ItemListCreateView,
    MyItemsView,
    approve_reject_view,
    create_claim_view,
    item_detail_view,
    stats_view,
)

urlpatterns = [
    path('items/', ItemListCreateView.as_view(), name='item-list-create'),
    path('items/my/', MyItemsView.as_view(), name='my-items'),
    path('items/<int:pk>/', item_detail_view, name='item-detail'),
    path('items/<int:pk>/claims/', create_claim_view, name='create-claim'),
    path('items/<int:pk>/claims/list/', ClaimListView.as_view(), name='claim-list'),
    path('claims/<int:pk>/<str:action>/', approve_reject_view, name='approve-reject'),
    path('categories/', CategoryListView.as_view(), name='category-list'),
    path('stats/', stats_view, name='stats'),
]
