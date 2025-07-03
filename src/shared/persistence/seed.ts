export const CATEGORIES_SEED: {
  id: string;
  name: string;
  code: string;
  description: string;
  transaction_type: 'income' | 'expense' | 'both';
}[] = [
  {
    id: 'f00110c1-fd2f-42d2-b579-8cc337668d82',
    name: '🏡 Moradia',
    code: '1',
    description:
      'aluguel, condomínio, contas de casa como luz, água, internet, gás, manutenção',
    transaction_type: 'expense',
  },
  {
    id: 'a29eb76c-0def-43ef-9c21-95928616e6f5',
    name: '🛒 Compras',
    code: '2',
    description:
      'supermercado, alimentação, higiene, farmácia, pequenas compras',
    transaction_type: 'expense',
  },
  {
    id: 'f2662cda-938f-4af6-8fcc-b9d6b7bfc061',
    name: '🚗 Transporte',
    code: '3',
    description: 'combustível, manutenção, uber, ônibus, estacionamento',
    transaction_type: 'expense',
  },
  {
    id: '9854990d-b348-4572-a077-dd4710cc9973',
    name: '🎓 Educação',
    code: '4',
    description: 'mensalidade, material escolar, cursos, livros',
    transaction_type: 'expense',
  },
  {
    id: '2d865bfa-84a3-4b06-9ac0-23bb50439954',
    name: '🏥 Saúde',
    code: '5',
    description: 'remédios, consultas, exames, plano de saúde',
    transaction_type: 'expense',
  },
  {
    id: 'c5d35a1b-5d61-4412-9083-52bd9468fbe5',
    name: '🎉 Lazer',
    code: '6',
    description: 'cinema, streaming, hobbies, bares, festas, games',
    transaction_type: 'expense',
  },
  {
    id: '206b9595-4929-4cc9-8bd9-8ec2aa73a27a',
    name: '💰 Investimentos',
    code: '7',
    description: 'poupança, aplicações, aportes',
    transaction_type: 'expense',
  },
  {
    id: '3562366d-861c-46de-a1f3-2d468134ec7f',
    name: '👪 Família & Pets',
    code: '8',
    description: 'filhos, pets, cuidados com parentes',
    transaction_type: 'expense',
  },
  {
    id: 'ee5bc836-ca4c-432e-afeb-fc8728f54350',
    name: '🎁 Presentes/Extras',
    code: '9',
    description: 'presentes, datas especiais, doações, imprevistos',
    transaction_type: 'expense',
  },
  {
    id: 'd9837314-2262-4ff1-a74c-a1a64deedd34',
    name: 'Outros',
    code: '10',
    description: 'Despesas diversas não categorizadas',
    transaction_type: 'both',
  },
  {
    id: 'd17708cd-dac1-4b3f-a647-c79840d67ee5',
    name: '💼 Trabalho',
    code: '11',
    description: 'salário, freelas, bônus, comissões',
    transaction_type: 'income',
  },
];
