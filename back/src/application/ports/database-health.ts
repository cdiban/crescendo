export interface DatabaseHealth {
  isUp(): Promise<boolean>;
}
