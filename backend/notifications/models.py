from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Kind(models.TextChoices):
        CLAIM_CREATED   = 'CLAIM_CREATED',   'Claim created'
        CLAIM_APPROVED  = 'CLAIM_APPROVED',  'Claim approved'
        CLAIM_REJECTED  = 'CLAIM_REJECTED',  'Claim rejected'
        CLAIM_WITHDRAWN = 'CLAIM_WITHDRAWN', 'Claim withdrawn'

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='+',
    )
    kind = models.CharField(max_length=20, choices=Kind.choices)
    item = models.ForeignKey('items.Item', on_delete=models.CASCADE)
    claim = models.ForeignKey(
        'items.Claim', on_delete=models.SET_NULL, null=True, blank=True
    )
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['recipient', 'read_at'])]

    def __str__(self):
        return f"[{self.kind}] to {self.recipient_id}"
