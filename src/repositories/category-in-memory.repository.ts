/* eslint-disable @typescript-eslint/require-await */
import { Category } from '../domain/category';
import { CategoryRepository } from './category.repository';

export class CategoryInMemoryRepository extends CategoryRepository {
  categories: Category[] = [
    new Category(
      'f00110c1-fd2f-42d2-b579-8cc337668d82',
      '🏡 Moradia',
      '1',
      'aluguel, condomínio, contas de casa como luz, água, internet, gás, manutenção',
    ),
    new Category(
      'a29eb76c-0def-43ef-9c21-95928616e6f5',
      '🛒 Compras',
      '2',
      'supermercado, alimentação, higiene, farmácia, pequenas compras',
    ),
    new Category(
      'f2662cda-938f-4af6-8fcc-b9d6b7bfc061',
      '🚗 Transporte',
      '3',
      'combustível, manutenção, uber, ônibus, estacionamento',
    ),
    new Category(
      '9854990d-b348-4572-a077-dd4710cc9973',
      '🎓 Educação',
      '4',
      'mensalidade, material escolar, cursos, livros',
    ),
    new Category(
      '2d865bfa-84a3-4b06-9ac0-23bb50439954',
      '🏥 Saúde',
      '5',
      'remédios, consultas, exames, plano de saúde',
    ),
    new Category(
      'c5d35a1b-5d61-4412-9083-52bd9468fbe5',
      '🎉 Lazer',
      '6',
      'cinema, streaming, hobbies, bares, festas, games',
    ),
    new Category(
      '206b9595-4929-4cc9-8bd9-8ec2aa73a27a',
      '💰 Investimentos',
      '7',
      'poupança, aplicações, aportes',
    ),
    new Category(
      '3562366d-861c-46de-a1f3-2d468134ec7f',
      '👪 Família & Pets',
      '8',
      'filhos, pets, cuidados com parentes',
    ),
    new Category(
      'ee5bc836-ca4c-432e-afeb-fc8728f54350',
      '🎁 Presentes/Extras',
      '9',
      'presentes, datas especiais, doações, imprevistos',
    ),
    new Category(
      'd9837314-2262-4ff1-a74c-a1a64deedd34',
      'Outros',
      '10',
      'Despesas diversas não categorizadas',
      'both',
    ),
    // agora categorias de receitas
    new Category(
      'd17708cd-dac1-4b3f-a647-c79840d67ee5',
      '💼 Trabalho',
      '11',
      'salário, freelas, bônus, comissões',
      'income',
    ),
  ];

  async findAll(): Promise<Category[]> {
    return this.categories;
  }

  async findById(id: string): Promise<Category | null> {
    const category = this.categories.find((cat) => cat.id === id);
    return category || null;
  }
}
