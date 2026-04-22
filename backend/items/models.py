from django.conf import settings
from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)
    icon = models.CharField(max_length=10)

    class Meta:
        verbose_name_plural = 'categories'

    def __str__(self):
        return f"{self.icon} {self.name}"


class ItemManager(models.Manager):
    def open_lost(self):
        return self.filter(item_type='LOST', status='OPEN')

    def open_found(self):
        return self.filter(item_type='FOUND', status='OPEN')


class Item(models.Model):
    class ItemType(models.TextChoices):
        LOST = 'LOST', 'Lost'
        FOUND = 'FOUND', 'Found'

    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        RESOLVED = 'RESOLVED', 'Resolved'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='items',
    )
    title = models.CharField(max_length=255)
    description = models.TextField()
    item_type = models.CharField(max_length=5, choices=ItemType.choices)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN)
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='items')
    location = models.CharField(max_length=255)
    image = models.CharField(max_length=500, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ItemManager()

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.item_type}] {self.title}"


class Claim(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        APPROVED = 'APPROVED', 'Approved'
        REJECTED = 'REJECTED', 'Rejected'

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='claims')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='claims',
    )
    message = models.TextField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'item'],
                condition=models.Q(status='PENDING'),
                name='unique_pending_claim_per_user_item',
            ),
        ]

    def __str__(self):
        return f"Claim on {self.item.title} by {self.user.username}"
