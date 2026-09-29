import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_cross_border extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cross_border_shipment_sales_allocations" alter column "unit_price" type numeric(18,4) using ("unit_price"::numeric(18,4));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cross_border_shipment_sales_allocations" alter column "unit_price" type numeric(18,6) using ("unit_price"::numeric(18,6));`);
  }

}
