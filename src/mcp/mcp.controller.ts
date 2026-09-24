import {
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DunaMcpServerFactory } from './duna-mcp-server.factory';
import { DunaAuthExtra } from './oauth/duna-oauth.provider';

/**
 * Streamable HTTP endpoint in stateless mode: each POST carries a complete
 * JSON-RPC exchange, answered as plain JSON. No MCP session is kept between
 * requests, so nothing is lost on restart and any instance can serve any call.
 * Authentication happens before this controller (bearer middleware in McpModule).
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly serverFactory: DunaMcpServerFactory) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const { vaultId } = req.auth!.extra as DunaAuthExtra;
    const server = this.serverFactory.create(vaultId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(`MCP request failed: ${error}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }

  // Stateless mode has no server-initiated stream nor session to terminate.
  @Get()
  @Delete()
  methodNotAllowed(@Res() res: Response) {
    res
      .status(405)
      .set('Allow', 'POST')
      .json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      });
  }
}
