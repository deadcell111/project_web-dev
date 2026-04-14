from rest_framework import serializers

from items.models import Category, Claim, Item


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'icon']


class ClaimSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = Claim
        fields = ['id', 'item', 'user', 'username', 'message', 'status', 'created_at']
        read_only_fields = ['id', 'item', 'user', 'username', 'status', 'created_at']


class ItemSerializer(serializers.ModelSerializer):
    category_detail = CategorySerializer(source='category', read_only=True)
    claims = ClaimSerializer(many=True, read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = Item
        fields = [
            'id', 'user', 'username', 'title', 'description',
            'item_type', 'status', 'category', 'category_detail',
            'location', 'image', 'created_at', 'updated_at', 'claims',
        ]
        read_only_fields = ['id', 'user', 'username', 'status', 'created_at', 'updated_at']
