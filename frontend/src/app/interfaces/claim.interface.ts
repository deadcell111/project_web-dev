export interface Claim {
  id: number;
  item: number;
  user: number;
  username: string;
  message: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
}

export interface MyClaim {
  id: number;
  item: number;
  user: number;
  username: string;
  message: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  user_telegram: string | null;
  owner_telegram: string | null;
  created_at: string;
  item_snapshot: {
    id: number;
    title: string;
    item_type: 'LOST' | 'FOUND';
    status: 'OPEN' | 'RESOLVED';
    image: string | null;
  };
}
