export type TableName =
  | 'users' | 'companies' | 'zones' | 'zone_countries' | 'students'
  | 'available_services' | 'active_subscriptions' | 'job_postings' | 'applications'
  | 'payment_records' | 'pay_per_job_purchases' | 'addons' | 'plan_zones'
  | 'subscription_addons' | 'subscription_zones' | 'system_config'
  | 'notifications' | 'notification_preferences' | 'password_reset_tokens';

/** legacy Mongo ObjectId (hex string) -> newly generated Postgres uuid, per table. */
export class IdMaps {
  private maps = new Map<TableName, Map<string, string>>();

  set(table: TableName, legacyId: string, uuid: string): void {
    if (!this.maps.has(table)) {
      this.maps.set(table, new Map());
    }
    this.maps.get(table)!.set(legacyId, uuid);
  }

  get(table: TableName, legacyId: string | null | undefined): string | null {
    if (!legacyId) {
      return null;
    }
    return this.maps.get(table)?.get(String(legacyId)) ?? null;
  }

  /** Use for required FKs - throws instead of silently nulling out a broken reference. */
  getOrThrow(table: TableName, legacyId: string | null | undefined, context: string): string {
    const id = this.get(table, legacyId);
    if (!id) {
      throw new Error(
        `Broken reference: ${context} points at ${table} legacy_id=${legacyId}, which was not found/loaded.`
      );
    }
    return id;
  }
}
