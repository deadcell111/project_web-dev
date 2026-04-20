export interface Claim {
  id: number;
  item: number;
  user: number;
  username: string;
  message: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
}
