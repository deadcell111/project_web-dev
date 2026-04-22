from rest_framework import serializers

from notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(
        source='actor.username', read_only=True, default=None
    )
    item_title = serializers.CharField(
        source='item.title', read_only=True
    )

    class Meta:
        model = Notification
        fields = [
            'id', 'kind', 'actor', 'actor_username', 'item', 'item_title',
            'claim', 'read_at', 'created_at',
        ]
        read_only_fields = fields
