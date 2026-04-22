export type NotificationKind =
  | 'CLAIM_CREATED'
  | 'CLAIM_APPROVED'
  | 'CLAIM_REJECTED'
  | 'CLAIM_WITHDRAWN';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  actor: number | null;
  actor_username: string | null;
  item: number;
  item_title: string;
  claim: number | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  results: AppNotification[];
  unread_count: number;
}
