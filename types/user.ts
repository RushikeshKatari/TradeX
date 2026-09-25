export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface UserSessionPayload {
  userId: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}
