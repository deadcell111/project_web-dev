import { Category } from './category.interface';
import { Claim } from './claim.interface';

export interface Item {
  id: number;
  user: number;
  username: string;
  title: string;
  description: string;
  item_type: 'LOST' | 'FOUND';
  status: 'OPEN' | 'CLAIMED' | 'RESOLVED';
  category: number;
  category_detail: Category;
  location: string;
  image: string | null;
  created_at: string;
  updated_at: string;
  claims: Claim[];
}

export interface PaginatedItems {
  count: number;
  next: string | null;
  previous: string | null;
  results: Item[];
}
