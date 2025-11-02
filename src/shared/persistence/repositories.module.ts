import { Module, Type } from '@nestjs/common';

type RepositoryConfig = 'in-memory' | 'sqlite';

@Module({})
export class RepositoriesModule {
  static config: RepositoryConfig;
  static forRoot(config: RepositoryConfig) {
    RepositoriesModule.config = config;
    console.log('RepositoriesModule.forRoot', config);
    return {
      module: RepositoriesModule,
    };
  }

  static forFeature(modulesPerConfig: Record<RepositoryConfig, Type>) {
    if (!modulesPerConfig[RepositoriesModule.config]) {
      throw new Error(
        `Unsupported repository configuration: ${RepositoriesModule.config}`,
      );
    }

    return {
      module: RepositoriesModule,
      imports: [modulesPerConfig[RepositoriesModule.config]],
      exports: [modulesPerConfig[RepositoriesModule.config]],
    };
  }
}
