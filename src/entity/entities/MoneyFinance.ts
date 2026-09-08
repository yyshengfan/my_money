import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("money_finance", { schema: "tianhuiaccount" })
export class MoneyFinance {
  @PrimaryGeneratedColumn({ type: "bigint", name: "id" })
  id: string;

  @Column("date", { name: "time", nullable: true, comment: "时间" })
  time: string | null;

  @Column("int", {
    name: "fund",
    nullable: true,
    comment: "基金",
    default: () => "'0'",
  })
  fund: number | null;

  @Column("int", {
    name: "fund_increase",
    nullable: true,
    comment: "fund盈亏",
    default: () => "'0'",
  })
  fundIncrease: number | null;

  @Column("int", {
    name: "bit_amount",
    nullable: true,
    comment: "币余",
    default: () => "'0'",
  })
  bitAmount: number | null;

  @Column("int", {
    name: "bit_increase",
    nullable: true,
    comment: "bit盈亏",
    default: () => "'0'",
  })
  bitIncrease: number | null;

  @Column("int", {
    name: "stock_amount",
    nullable: true,
    comment: "股余",
    default: () => "'0'",
  })
  stockAmount: number | null;

  @Column("int", {
    name: "stock_increase",
    nullable: true,
    comment: "stock盈亏",
    default: () => "'0'",
  })
  stockIncrease: number | null;

  @Column("int", {
    name: "hk_stock",
    nullable: true,
    comment: "股余",
    default: () => "'0'",
  })
  hkStock: number | null;

  @Column("int", {
    name: "hk_stock_increase",
    nullable: true,
    comment: "stock盈亏",
    default: () => "'0'",
  })
  hkStockIncrease: number | null;

  @Column("int", {
    name: "zfb_amount",
    nullable: true,
    comment: "zfb",
    default: () => "'0'",
  })
  zfbAmount: number | null;

  @Column("int", {
    name: "zfb_increase",
    nullable: true,
    comment: "zfb盈亏",
    default: () => "'0'",
  })
  zfbIncrease: number | null;

  @Column("int", {
    name: "sum_increase",
    nullable: true,
    comment: "总盈亏",
    default: () => "'0'",
  })
  sumIncrease: number | null;

  @Column("int", { name: "money", nullable: true, comment: "余额" })
  money: number | null;

  @Column("varchar", {
    name: "comment",
    nullable: true,
    comment: "备注",
    length: 255,
  })
  comment: string | null;
}
