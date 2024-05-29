import { Column, Entity } from 'typeorm';

@Entity('money', { schema: 'my_account' })
export class Money {
  @Column('int', { primary: true, name: 'id', comment: '主键ID' })
  id: number;

  @Column('date', { name: 'time', nullable: true, comment: '时间' })
  time: string | null;

  @Column('int', { name: 'salary', nullable: true, comment: '工资' })
  salary: number | null;

  @Column('int', { name: 'inmoney', nullable: true, comment: '进账' })
  inmoney: number | null;

  @Column('int', { name: 'credit', nullable: true, comment: '信用卡消费' })
  credit: number | null;

  @Column('int', {
    name: 'outmoney_other',
    nullable: true,
    comment: '定向支出',
  })
  outmoneyOther: number | null;

  @Column('int', { name: 'outmoney_rent', nullable: true, comment: '房租支出' })
  outmoneyRent: number | null;

  @Column('int', {
    name: 'outmoney_mortgage',
    nullable: true,
    comment: '房贷支出',
  })
  outmoneyMortgage: number | null;

  @Column('int', {
    name: 'outmoney_social_security',
    nullable: true,
    comment: '社保支出',
  })
  outmoneySocialSecurity: number | null;

  @Column('int', { name: 'outmoney_cons', nullable: true, comment: '出帐' })
  outmoneyCons: number | null;

  @Column('int', { name: 'outmoney_net', nullable: true, comment: '净支出' })
  outmoneyNet: number | null;

  @Column('int', { name: 'increment', nullable: true, comment: '增量' })
  increment: number | null;

  @Column('int', { name: 'periodical', nullable: true, comment: '存款' })
  periodical: number | null;

  @Column('int', { name: 'fund', nullable: true, comment: '基金' })
  fund: number | null;

  @Column('int', { name: 'bit_amount', nullable: true, comment: '币余' })
  bitAmount: number | null;

  @Column('int', { name: 'bit_profit', nullable: true, comment: 'bit盈亏' })
  bitProfit: number | null;

  @Column('int', { name: 'stock_amount', nullable: true, comment: '股余' })
  stockAmount: number | null;

  @Column('int', { name: 'stock_profit', nullable: true, comment: 'stock盈亏' })
  stockProfit: number | null;

  @Column('int', { name: 'zfb_amount', nullable: true, comment: 'zfb' })
  zfbAmount: number | null;

  @Column('int', { name: 'zfb_profit', nullable: true, comment: 'zfb盈亏' })
  zfbProfit: number | null;

  @Column('int', { name: 'money', nullable: true, comment: '余额' })
  money: number | null;

  @Column('varchar', {
    name: 'comment',
    nullable: true,
    comment: '备注',
    length: 255,
  })
  comment: string | null;
}
