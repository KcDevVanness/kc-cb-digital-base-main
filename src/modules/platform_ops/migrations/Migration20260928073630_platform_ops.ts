import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_platform_ops extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "platform_ops_order_mirrors" alter column "fee_amount" type numeric(18,2) using ("fee_amount"::numeric(18,2));`);
    this.addSql(`alter table "platform_ops_order_mirrors" alter column "gross_amount" type numeric(18,2) using ("gross_amount"::numeric(18,2));`);
    this.addSql(`alter table "platform_ops_order_mirrors" alter column "net_amount" type numeric(18,2) using ("net_amount"::numeric(18,2));`);

    this.addSql(`alter table "platform_ops_reconciliation_items" alter column "actual_amount" type numeric(18,2) using ("actual_amount"::numeric(18,2));`);
    this.addSql(`alter table "platform_ops_reconciliation_items" alter column "expected_amount" type numeric(18,2) using ("expected_amount"::numeric(18,2));`);

    this.addSql(`alter table "platform_ops_settlements" alter column "fee_amount" type numeric(18,2) using ("fee_amount"::numeric(18,2));`);
    this.addSql(`alter table "platform_ops_settlements" alter column "gross_amount" type numeric(18,2) using ("gross_amount"::numeric(18,2));`);
    this.addSql(`alter table "platform_ops_settlements" alter column "net_amount" type numeric(18,2) using ("net_amount"::numeric(18,2));`);

    this.addSql(`alter table "platform_ops_settlement_lines" alter column "fee_amount" type numeric(18,2) using ("fee_amount"::numeric(18,2));`);
    this.addSql(`alter table "platform_ops_settlement_lines" alter column "gross_amount" type numeric(18,2) using ("gross_amount"::numeric(18,2));`);
    this.addSql(`alter table "platform_ops_settlement_lines" alter column "net_amount" type numeric(18,2) using ("net_amount"::numeric(18,2));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "platform_ops_order_mirrors" alter column "gross_amount" type numeric(18,4) using ("gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "platform_ops_order_mirrors" alter column "fee_amount" type numeric(18,4) using ("fee_amount"::numeric(18,4));`);
    this.addSql(`alter table "platform_ops_order_mirrors" alter column "net_amount" type numeric(18,4) using ("net_amount"::numeric(18,4));`);

    this.addSql(`alter table "platform_ops_reconciliation_items" alter column "expected_amount" type numeric(18,4) using ("expected_amount"::numeric(18,4));`);
    this.addSql(`alter table "platform_ops_reconciliation_items" alter column "actual_amount" type numeric(18,4) using ("actual_amount"::numeric(18,4));`);

    this.addSql(`alter table "platform_ops_settlement_lines" alter column "gross_amount" type numeric(18,4) using ("gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "platform_ops_settlement_lines" alter column "fee_amount" type numeric(18,4) using ("fee_amount"::numeric(18,4));`);
    this.addSql(`alter table "platform_ops_settlement_lines" alter column "net_amount" type numeric(18,4) using ("net_amount"::numeric(18,4));`);

    this.addSql(`alter table "platform_ops_settlements" alter column "gross_amount" type numeric(18,4) using ("gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "platform_ops_settlements" alter column "fee_amount" type numeric(18,4) using ("fee_amount"::numeric(18,4));`);
    this.addSql(`alter table "platform_ops_settlements" alter column "net_amount" type numeric(18,4) using ("net_amount"::numeric(18,4));`);
  }

}
