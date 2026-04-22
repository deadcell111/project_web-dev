from notifications.models import Notification


def notify(*, recipient, actor, kind: str, item, claim=None):
    if recipient == actor:
        # never notify yourself
        return None
    return Notification.objects.create(
        recipient=recipient,
        actor=actor,
        kind=kind,
        item=item,
        claim=claim,
    )
