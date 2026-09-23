import { Migration } from '@mikro-orm/migrations';

export class Migration20260922082558_cross_border extends Migration {

  override name = 'Migration20260922082558';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cross_border_shipments" add "container_type" text null, add "container_number" text null, add "seal_number" text null, add "booking_number" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cross_border_shipments" drop column "container_type", drop column "container_number", drop column "seal_number", drop column "booking_number";`);
  }

}
