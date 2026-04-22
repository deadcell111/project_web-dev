export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_staff: boolean;
  telegram: string;
  phone: string;
  avatar: string | null;        // presigned GET URL
  avatar_key: string | null;    // object key, for re-submit on profile update
}
