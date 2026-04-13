from django.contrib import admin

from items.models import Category, Claim, Item


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'icon')


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'item_type', 'status', 'user', 'category', 'created_at')
    list_filter = ('item_type', 'status', 'category')
    search_fields = ('title', 'description')


@admin.register(Claim)
class ClaimAdmin(admin.ModelAdmin):
    list_display = ('item', 'user', 'status', 'created_at')
    list_filter = ('status',)
