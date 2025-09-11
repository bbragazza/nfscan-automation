// Script de automação para NFScan Bosch com SSO Microsoft
// Compatível com N8N - pode ser usado no node "Execute Code"

const puppeteer = require('puppeteer');

class NFScanBoschAutomation {
    constructor(credentials) {
        this.boschId = credentials.boschId; // ex: bra2ca@bosch.com
        this.password = credentials.password;
        this.baseUrl = 'https://nfscan.bosch.tech';
        this.browser = null;
        this.page = null;
    }

    async init(headless = false) {
        console.log('Iniciando navegador...');
        this.browser = await puppeteer.launch({
            headless: headless, // false para debug, true para produção
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        this.page = await this.browser.newPage();
        
        // Configurações para evitar detecção e melhorar compatibilidade
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await this.page.setViewport({ width: 1366, height: 768 });
        await this.page.setDefaultTimeout(60000); // 60 segundos para SSO corporativo
        
        // Configurar permissão de geolocalização automaticamente
        const context = this.browser.defaultBrowserContext();
        await context.overridePermissions(this.baseUrl, ['geolocation']);
    }

    async loginBoschSSO() {
        try {
            console.log('Navegando para NFScan...');
            await this.page.goto(`${this.baseUrl}/nfscan/document/list`, {
                waitUntil: 'networkidle2'
            });

            // PASSO 1: Clicar em "Entrar com meu BOSCH ID"
            console.log('Procurando botão de login Bosch...');
            await this.page.waitForSelector('button:has-text("Entrar com meu BOSCH ID"), a:has-text("Entrar com meu BOSCH ID")', {
                timeout: 15000
            });
            await this.page.click('button:has-text("Entrar com meu BOSCH ID"), a:has-text("Entrar com meu BOSCH ID")');

            // PASSO 2: Inserir BOSCH ID (email)
            console.log('Inserindo BOSCH ID...');
            await this.page.waitForSelector('input[type="email"], input[name="loginfmt"], input[placeholder*="@bosch.com"]', {
                timeout: 15000
            });
            
            // Limpar e preencher o campo de email
            const emailInput = await this.page.$('input[type="email"], input[name="loginfmt"]');
            await emailInput.click({ clickCount: 3 }); // Selecionar todo o texto
            await emailInput.type(this.boschId);
            
            // Clicar em Avançar/Next
            await this.page.click('input[type="submit"][value="Avançar"], input[type="submit"][value="Next"], button#idSIButton9');
            
            // PASSO 3: Inserir senha
            console.log('Inserindo senha...');
            await this.page.waitForSelector('input[type="password"]', {
                timeout: 15000
            });
            await this.page.type('input[type="password"]', this.password);
            
            // Clicar em Entrar/Sign in
            await this.page.click('input[type="submit"][value="Entrar"], input[type="submit"][value="Sign in"], button#idSIButton9');

            // PASSO 4: Aguardar autenticação MFA
            console.log('Aguardando autenticação de dois fatores (Microsoft Authenticator)...');
            console.log('Por favor, aprove a autenticação no seu dispositivo móvel...');
            
            // Aguardar o código ou aprovação do MFA
            // O sistema vai esperar até 60 segundos pela aprovação
            await this.page.waitForSelector('input[name="DontShowAgain"], #KmsiCheckboxField, text=/Continuar conectado/i, text=/Stay signed in/i', {
                timeout: 60000
            }).catch(() => {
                console.log('MFA pode ter sido aprovado automaticamente ou não é necessário');
            });

            // PASSO 5: Decidir se mantém conectado
            // Marcar checkbox se existir
            const staySignedIn = await this.page.$('input[type="checkbox"][name="DontShowAgain"], #KmsiCheckboxField');
            if (staySignedIn) {
                await staySignedIn.click();
            }
            
            // Clicar em Sim/Yes para continuar conectado
            await this.page.click('input[type="submit"][value="Sim"], input[type="submit"][value="Yes"], button:has-text("Sim")');

            // PASSO 6: Aguardar redirecionamento para o NFScan
            console.log('Finalizando login...');
            await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
            
            // Verificar se chegou na página principal do NFScan
            await this.page.waitForSelector('button:has-text("Escanear"), a:has-text("Escanear")', {
                timeout: 15000
            });
            
            // Lidar com popup de geolocalização se aparecer
            await this.handleGeolocationPopup();
            
            console.log('Login realizado com sucesso!');
            return true;

        } catch (error) {
            console.error('Erro no login:', error.message);
            await this.page.screenshot({ path: 'erro-login.png' });
            return false;
        }
    }

    async handleGeolocationPopup() {
        try {
            // Verificar se aparece o popup de geolocalização
            const geolocationDialog = await this.page.$('button:has-text("Permitir ao acessar o site"), button:has-text("Permitir desta vez")');
            if (geolocationDialog) {
                console.log('Permitindo acesso à geolocalização...');
                await geolocationDialog.click();
            }
        } catch (error) {
            console.log('Popup de geolocalização não encontrado ou já foi tratado');
        }
    }

    async uploadAndProcessNF(pdfPath, nfData) {
        try {
            // PASSO 7: Clicar em "Escanear"
            console.log('Iniciando processo de escaneamento...');
            await this.page.waitForSelector('button:has-text("Escanear"), a:has-text("Escanear")', {
                timeout: 10000
            });
            await this.page.click('button:has-text("Escanear"), a:has-text("Escanear")');

            // PASSO 8: Fazer upload do arquivo
            console.log('Fazendo upload do arquivo PDF...');
            const fileInput = await this.page.waitForSelector('input[type="file"]', {
                timeout: 10000
            });
            await fileInput.uploadFile(pdfPath);

            // PASSO 9: Confirmar upload clicando em "Salvar"
            console.log('Confirmando upload...');
            await this.page.waitForSelector('button:has-text("Salvar"), input[value="Salvar"]', {
                timeout: 10000
            });
            await this.page.click('button:has-text("Salvar"), input[value="Salvar"]');

            // PASSO 10: Aguardar análise
            console.log('Aguardando análise do documento...');
            
            // Aguardar a mensagem de análise desaparecer ou o formulário aparecer
            await this.page.waitForFunction(
                () => !document.querySelector('text=/Aguardando|Analisando|Iniciando análise/i'),
                { timeout: 30000 }
            );

            // PASSO 11: Preencher campos do formulário
            console.log('Preenchendo campos do formulário...');
            await this.fillNFForm(nfData);

            // PASSO 12: Salvar documento final
            console.log('Salvando documento...');
            await this.saveDocument();

            return true;

        } catch (error) {
            console.error('Erro no processamento da NF:', error.message);
            await this.page.screenshot({ path: 'erro-upload.png' });
            return false;
        }
    }

    async fillNFForm(nfData) {
        try {
            // Aguardar o formulário carregar completamente
            await this.page.waitForTimeout(2000);

            // Mapear e preencher cada campo
            const fieldMappings = [
                {
                    field: 'valor',
                    selectors: ['input[name*="valor"]', 'input[name*="amount"]', 'input[placeholder*="R$"]', 'input.currency'],
                    value: nfData.valor
                },
                {
                    field: 'numeroNota',
                    selectors: ['input[name*="numero"]', 'input[name*="number"]', 'input[placeholder*="número"]', 'input[placeholder*="NF"]'],
                    value: nfData.numeroNF
                },
                {
                    field: 'dataEmissao',
                    selectors: ['input[type="date"]', 'input[name*="data"]', 'input[name*="date"]', 'input[placeholder*="dd/mm/yyyy"]'],
                    value: nfData.dataEmissao
                },
                {
                    field: 'cnpj',
                    selectors: ['input[name*="cnpj"]', 'input[name*="CNPJ"]', 'input[placeholder*="CNPJ"]', 'input[placeholder*="00.000.000/0001-00"]'],
                    value: nfData.cnpj
                },
                {
                    field: 'razaoSocial',
                    selectors: ['input[name*="razao"]', 'input[name*="empresa"]', 'input[name*="company"]', 'input[placeholder*="Razão Social"]'],
                    value: nfData.razaoSocial
                },
                {
                    field: 'evento',
                    selectors: ['input[name*="evento"]', 'input[name*="event"]', 'textarea[name*="evento"]'],
                    value: nfData.evento || 'Despesa de viagem'
                },
                {
                    field: 'comentario',
                    selectors: ['textarea[name*="comentario"]', 'textarea[name*="comment"]', 'textarea[name*="observa"]', 'input[name*="descri"]'],
                    value: nfData.comentario || ''
                }
            ];

            // Preencher cada campo
            for (const mapping of fieldMappings) {
                if (mapping.value) {
                    let filled = false;
                    for (const selector of mapping.selectors) {
                        const element = await this.page.$(selector);
                        if (element) {
                            console.log(`Preenchendo ${mapping.field}: ${mapping.value}`);
                            
                            // Limpar campo antes de preencher
                            await element.click({ clickCount: 3 });
                            await this.page.keyboard.press('Backspace');
                            
                            // Preencher o valor
                            await element.type(mapping.value.toString());
                            filled = true;
                            break;
                        }
                    }
                    if (!filled) {
                        console.warn(`Campo não encontrado: ${mapping.field}`);
                    }
                }
            }

            // Tratar categoria como dropdown se necessário
            if (nfData.categoria) {
                console.log(`Selecionando categoria: ${nfData.categoria}`);
                const categorySelect = await this.page.$('select[name*="categoria"], select[name*="category"]');
                if (categorySelect) {
                    // Tentar selecionar pelo texto visível
                    await this.page.select('select[name*="categoria"], select[name*="category"]', nfData.categoria);
                } else {
                    // Se não for select, pode ser um dropdown customizado
                    const categoryDropdown = await this.page.$('[class*="dropdown"][class*="categoria"], [class*="category"]');
                    if (categoryDropdown) {
                        await categoryDropdown.click();
                        await this.page.waitForTimeout(500);
                        await this.page.click(`text=/${nfData.categoria}/i`);
                    }
                }
            }

            console.log('Formulário preenchido com sucesso!');
            return true;

        } catch (error) {
            console.error('Erro ao preencher formulário:', error.message);
            return false;
        }
    }

    async saveDocument() {
        try {
            // Aguardar botão de salvar ficar habilitado
            await this.page.waitForTimeout(1000);
            
            // Procurar e clicar no botão Salvar
            const saveButton = await this.page.waitForSelector(
                'button:has-text("Salvar"):not([disabled]), input[type="submit"][value="Salvar"]:not([disabled])',
                { timeout: 10000 }
            );
            
            await saveButton.click();
            
            // Aguardar confirmação de salvamento
            await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
            
            // Verificar se voltou para a lista de documentos ou mostrou mensagem de sucesso
            const success = await this.page.waitForSelector(
                'text=/salvo com sucesso|successfully saved|documento anexado/i, button:has-text("Escanear")',
                { timeout: 5000 }
            ).catch(() => null);
            
            if (success) {
                console.log('Documento salvo com sucesso!');
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('Erro ao salvar documento:', error.message);
            return false;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    // Método principal para processar uma NF completa
    async processNF(pdfPath, nfData) {
        try {
            await this.init(true); // true para headless em produção
            
            const loginSuccess = await this.loginBoschSSO();
            if (!loginSuccess) {
                throw new Error('Falha no login SSO');
            }
            
            const processSuccess = await this.uploadAndProcessNF(pdfPath, nfData);
            if (!processSuccess) {
                throw new Error('Falha no processamento da NF');
            }
            
            return {
                success: true,
                message: 'NF processada e salva com sucesso!',
                data: nfData
            };
            
        } catch (error) {
            console.error('Erro no processamento:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            await this.close();
        }
    }
}

// ========================================
// INTEGRAÇÃO COM N8N
// ========================================

// Para N8N, você pode usar esta função wrapper
async function processNFInN8N(items) {
    // items[0].json contém os dados do N8N
    const inputData = items[0].json;
    
    // Configurar credenciais (use as credenciais do N8N)
    const credentials = {
        boschId: $credentials.boschId || inputData.boschId,
        password: $credentials.password || inputData.password
    };
    
    // Dados da NF vindos do agente de IA
    const nfData = {
        numeroNF: inputData.numeroNF,
        dataEmissao: inputData.dataEmissao,
        valor: inputData.valor,
        cnpj: inputData.cnpj,
        razaoSocial: inputData.razaoSocial,
        categoria: inputData.categoria || 'Serviço de táxi / transferência',
        evento: inputData.evento || 'Despesa de viagem',
        comentario: inputData.comentario || ''
    };
    
    // Caminho do PDF (pode vir de um node anterior do N8N)
    const pdfPath = inputData.pdfPath;
    
    // Processar a NF
    const automation = new NFScanBoschAutomation(credentials);
    const result = await automation.processNF(pdfPath, nfData);
    
    // Retornar resultado para o N8N
    return [{
        json: result,
        binary: {}
    }];
}

// ========================================
// EXEMPLO DE USO STANDALONE
// ========================================

async function exemploDeUso() {
    const credentials = {
        boschId: 'bra2ca@bosch.com',
        password: 'sua_senha_aqui' // NÃO hardcode em produção!
    };
    
    const nfData = {
        numeroNF: 'xyz',
        dataEmissao: '06/08/2025',
        valor: '48.46',
        cnpj: '00.000.000/0001-00',
        razaoSocial: 'Uber',
        categoria: 'Serviço de táxi / transferência',
        evento: 'Escolha um',
        comentario: ''
    };
    
    const automation = new NFScanBoschAutomation(credentials);
    const result = await automation.processNF('/caminho/para/nf_uber.pdf', nfData);
    
    console.log('Resultado:', result);
}

// Exportar para uso em outros módulos
module.exports = {
    NFScanBoschAutomation,
    processNFInN8N
};

// Descomente para testar localmente
// exemploDeUso();
