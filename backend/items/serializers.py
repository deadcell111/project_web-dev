from rest_framework import serializers

from common.storage import presign_get
from items.models import Category, Claim, Item


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'icon']


class ClaimSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    user_telegram = serializers.SerializerMethodField()
    owner_telegram = serializers.SerializerMethodField()

    class Meta:
        model = Claim
        fields = [
            'id', 'item', 'user', 'username', 'message', 'status',
            'user_telegram', 'owner_telegram', 'created_at',
        ]
        read_only_fields = [
            'id', 'item', 'user', 'username', 'status',
            'user_telegram', 'owner_telegram', 'created_at',
        ]

    def get_user_telegram(self, obj: Claim):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return None
        if obj.status != 'APPROVED':
            return None
        if request.user != obj.item.user and request.user != obj.user:
            return None
        return getattr(obj.user.profile, 'telegram', '') or None

    def get_owner_telegram(self, obj: Claim):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return None
        if obj.status != 'APPROVED':
            return None
        if request.user != obj.item.user and request.user != obj.user:
            return None
        return getattr(obj.item.user.profile, 'telegram', '') or None


class ItemSerializer(serializers.ModelSerializer):
    category_detail = CategorySerializer(source='category', read_only=True)
    claims = ClaimSerializer(many=True, read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    owner_telegram = serializers.SerializerMethodField()
    pending_claims_count = serializers.SerializerMethodField()
    image = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=500,
    )
    image_key = serializers.CharField(read_only=True, allow_null=True)

    class Meta:
        model = Item
        fields = [
            'id', 'user', 'username', 'title', 'description',
            'item_type', 'status', 'category', 'category_detail',
            'location', 'image', 'image_key',
            'owner_telegram', 'pending_claims_count',
            'created_at', 'updated_at', 'claims',
        ]
        read_only_fields = [
            'id', 'user', 'username', 'status',
            'pending_claims_count', 'owner_telegram',
            'created_at', 'updated_at',
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        raw = data.get('image')
        data['image_key'] = raw
        data['image'] = presign_get(raw)
        return data

    def get_pending_claims_count(self, obj: Item):
        return sum(1 for c in obj.claims.all() if c.status == 'PENDING')

    def get_owner_telegram(self, obj: Item):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return None
        # Reveal owner telegram to users whose claim on this item is APPROVED
        approved_claim = next(
            (c for c in obj.claims.all()
             if c.user_id == request.user.id and c.status == 'APPROVED'),
            None,
        )
        if approved_claim is None:
            return None
        return getattr(obj.user.profile, 'telegram', '') or None
