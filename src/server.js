// src/server.js
// Servidor Express que expõe a automação como API para o N8N

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');
const { NFScanBoschAutomation } = require('./nfscan-automation');
const logger = require('./utils/logger');

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar multer para upload de arquivos
const upload = multer({
    dest: '/tmp/uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF são permitidos'));
        }
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'NFScan Automation',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Endpoint principal para processar NF
app.post('/process-nf', upload.single('pdf'), async (req, res) => {
    const startTime = Date.now();
    let pdfPath = null;
    
    try {
        // Validar entrada
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Arquivo PDF é obrigatório'
            });
        }
        
        pdfPath = req.file.path;
        
        // Pegar dados da NF do body
        const nfData = {
            numeroNF: req.body.numeroNF || '',
            dataEmissao: req.body.dataEmissao || '',
            valor: req.body.valor || '',
            cnpj: req.body.cnpj || '',
            razaoSocial: req.body.razaoSocial || '',
            categoria: req.body.categoria || 'Serviço de táxi / transferência',
            evento: req.body.evento || 'Despesa de viagem',
            comentario: req.body.comentario || ''
        };
        
        // Pegar credenciais (podem vir do body ou env)
        const credentials = {
            boschId: req.body.boschId || process.env.BOSCH_ID,
            password: req.body.password || process.env.BOSCH_PASSWORD
        };
        
        if (!credentials.boschId || !credentials.password) {
            return res.status(400).json({
                success: false,
                error: 'Credenciais Bosch são obrigatórias'
            });
        }
        
        logger.info('Iniciando processamento de NF', {
            numeroNF: nfData.numeroNF,
            razaoSocial: nfData.razaoSocial
        });
        
        // Processar NF
        const automation = new NFScanBoschAutomation(credentials);
        const result = await automation.processNF(pdfPath, nfData);
        
        const processingTime = Date.now() - startTime;
        
        // Registrar resultado
        logger.info('Processamento concluído', {
            success: result.success,
            processingTime,
            numeroNF: nfData.numeroNF
        });
        
        // Responder
        res.json({
            ...result,
            processingTime: `${processingTime}ms`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('Erro no processamento', {
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
    } finally {
        // Limpar arquivo temporário
        if (pdfPath) {
            try {
                await fs.unlink(pdfPath);
            } catch (err) {
                logger.error('Erro ao deletar arquivo temporário', { error: err.message });
            }
        }
    }
});

// Endpoint para processar via URL do PDF (útil para N8N)
app.post('/process-nf-url', async (req, res) => {
    const axios = require('axios');
    const startTime = Date.now();
    let pdfPath = null;
    
    try {
        const { pdfUrl, nfData, credentials } = req.body;
        
        if (!pdfUrl) {
            return res.status(400).json({
                success: false,
                error: 'URL do PDF é obrigatória'
            });
        }
        
        // Baixar PDF da URL
        logger.info('Baixando PDF da URL', { url: pdfUrl });
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        
        // Salvar PDF temporariamente
        pdfPath = `/tmp/nf_${Date.now()}.pdf`;
        await fs.writeFile(pdfPath, response.data);
        
        // Usar credenciais do body ou env
        const authCredentials = {
            boschId: credentials?.boschId || process.env.BOSCH_ID,
            password: credentials?.password || process.env.BOSCH_PASSWORD
        };
        
        // Processar NF
        const automation = new NFScanBoschAutomation(authCredentials);
        const result = await automation.processNF(pdfPath, nfData);
        
        const processingTime = Date.now() - startTime;
        
        res.json({
            ...result,
            processingTime: `${processingTime}ms`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('Erro no processamento via URL', {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
    } finally {
        if (pdfPath) {
            try {
                await fs.unlink(pdfPath);
            } catch (err) {
                logger.error('Erro ao deletar arquivo temporário', { error: err.message });
            }
        }
    }
});

// Endpoint para testar autenticação
app.post('/test-auth', async (req, res) => {
    try {
        const credentials = {
            boschId: req.body.boschId || process.env.BOSCH_ID,
            password: req.body.password || process.env.BOSCH_PASSWORD
        };
        
        const automation = new NFScanBoschAutomation(credentials);
        await automation.init(true);
        const loginSuccess = await automation.loginBoschSSO();
        await automation.close();
        
        res.json({
            success: loginSuccess,
            message: loginSuccess ? 'Autenticação bem sucedida' : 'Falha na autenticação'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('Erro não tratado', {
        error: err.message,
        stack: err.stack
    });
    
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: err.message
    });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Servidor NFScan Automation rodando na porta ${PORT}`);
    console.log(`🚀 NFScan Automation API rodando em http://0.0.0.0:${PORT}`);
    console.log(`📊 Health check disponível em http://0.0.0.0:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM recebido, encerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT recebido, encerrando servidor...');
    process.exit(0);
});
