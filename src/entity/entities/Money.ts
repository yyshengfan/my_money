import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("money", { schema: "tianhuiaccount" })
export class Money {
  @PrimaryGeneratedColumn({ type: "bigint", name: "id" })
  id: string;

  @Column("date", { name: "time", nullable: true, comment: "时间" })
  time: string | null;

  @Column("int", { name: "salary", nullable: true, comment: "工资" })
  salary: number | null;

  @Column("int", { name: "inmoney", nullable: true, comment: "进账" })
  inmoney: number | null;

  @Column("int", { name: "periodical", nullable: true, comment: "零钱" })
  periodical: number | null;

  @Column("int", {
    name: "periodical_increase",
    nullable: true,
    comment: "零钱增量",
  })
  periodicalIncrease: number | null;

  @Column("int", { name: "credit", nullable: true, comment: "信用卡消费" })
  credit: number | null;

  @Column("int", { name: "outmoney_rent", nullable: true, comment: "房租支出" })
  outmoneyRent: number | null;

  @Column("int", {
    name: "outmoney_mortgage",
    nullable: true,
    comment: "房贷支出",
  })
  outmoneyMortgage: number | null;

  @Column("int", {
    name: "outmoney_social_security",
    nullable: true,
    comment: "社保支出",
  })
  outmoneySocialSecurity: number | null;

  @Column("int", {
    name: "outmoney_other",
    nullable: true,
    comment: "其他支出",
  })
  outmoneyOther: number | null;

  @Column("int", { name: "outmoney_cons", nullable: true, comment: "总出帐" })
  outmoneyCons: number | null;

  @Column("int", { name: "outmoney_net", nullable: true, comment: "净支出" })
  outmoneyNet: number | null;

  @Column("int", { name: "outmoney_life", nullable: true, comment: "生活开支" })
  outmoneyLife: number | null;

  @Column("int", { name: "increment", nullable: true, comment: "增量" })
  increment: number | null;

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
