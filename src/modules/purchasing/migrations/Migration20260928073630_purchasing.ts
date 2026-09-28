import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_purchasing extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_orders" alter column "deposit_amount" type numeric(18,2) using ("deposit_amount"::numeric(18,2));`);
    this.addSql(`alter table "purchasing_purchase_orders" alter column "subtotal" type numeric(18,2) using ("subtotal"::numeric(18,2));`);
    this.addSql(`alter table "purchasing_purchase_orders" alter column "tax_total" type numeric(18,2) using ("tax_total"::numeric(18,2));`);
    this.addSql(`alter table "purchasing_purchase_orders" alter column "total" type numeric(18,2) using ("total"::numeric(18,2));`);

    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "line_total" type numeric(18,2) using ("line_total"::numeric(18,2));`);
    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "net_total" type numeric(18,2) using ("net_total"::numeric(18,2));`);
    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "tax_amount" type numeric(18,2) using ("tax_amount"::numeric(18,2));`);

    this.addSql(`alter table "purchasing_purchase_payments" alter column "amount" type numeric(18,2) using ("amount"::numeric(18,2));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "net_total" type numeric(18,4) using ("net_total"::numeric(18,4));`);
    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "tax_amount" type numeric(18,4) using ("tax_amount"::numeric(18,4));`);
    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "line_total" type numeric(18,4) using ("line_total"::numeric(18,4));`);

    this.addSql(`alter table "purchasing_purchase_orders" alter column "subtotal" type numeric(18,4) using ("subtotal"::numeric(18,4));`);
    this.addSql(`alter table "purchasing_purchase_orders" alter column "tax_total" type numeric(18,4) using ("tax_total"::numeric(18,4));`);
    this.addSql(`alter table "purchasing_purchase_orders" alter column "total" type numeric(18,4) using ("total"::numeric(18,4));`);
    this.addSql(`alter table "purchasing_purchase_orders" alter column "deposit_amount" type numeric(18,4) using ("deposit_amount"::numeric(18,4));`);

    this.addSql(`alter table "purchasing_purchase_payments" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);
  }

}
