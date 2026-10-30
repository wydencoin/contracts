# contracts — WydenCoin

Contratos Solidity da arquitetura WydenCoin. Responsável: **Carlos Mikael**.

| Contrato | Descrição | Estado |
| --- | --- | --- |
| [`WydenCoin.sol`](contracts/WydenCoin.sol) | ERC-20 (símbolo `WC`), 0 decimais, emissão com motivo (`bytes32`), emissão em lote atômica, transferência P2P entre alunos bloqueada | **v0 testado** (11 testes) |
| [`RedemptionManager.sol`](contracts/RedemptionManager.sol) | Gerenciador do ciclo de vida dos resgates: bloquear tokens em custódia, confirmar uso (queimar/burn), cancelar ou expirar (restituir saldo) | **v0 testado** (14 testes) |

---

## 🚀 Como Rodar

### Instalação de Dependências
```bash
npm ci
```

### Execução dos Testes Automatizados
```bash
npm test
# ou: npx hardhat test
```
A suíte executa 26 testes cobrindo permissões, limites, reversões e uma simulação real de 213 emissões em lote para 66 alunos.

### Rede Local de Desenvolvimento (Hardhat Node)
```bash
npx hardhat node
```

### Deploy dos Contratos
Para deploy local em memória ou no Hardhat Node:
```bash
npm run deploy:local
```

Para deploy na rede **Hyperledger Besu**:
1. Copie o arquivo de exemplo de ambiente:
   ```bash
   cp .env.example .env
   ```
2. Preencha `DEPLOYER_PRIVATE_KEY` e demais contas opcionais (`MINTER_ADDRESS`, etc.).
3. Execute:
   ```bash
   npm run deploy:besu
   ```
Os endereços implantados são automaticamente registrados em `addresses.json`.

---

## 🔐 Papéis e Governança (AccessControl)

| Papel | Contrato | Finalidade | Responsável / Destinatário |
| --- | --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | WydenCoin & RedemptionManager | Administração de roles e configuração do endereço do contrato de resgate (`setRedemptionManager`) | Deployer / Governança |
| `MINTER_ROLE` | WydenCoin | Autorização exclusiva para emissão individual (`mintReward`) e em lote (`mintRewardBatch`) | Backend / Motor de Recompensas |
| `CONFIRMER_ROLE` | RedemptionManager | Validação presencial/operacional do voucher e execução da queima dos tokens (`confirmarUso`) | API dos Estabelecimentos / Operadores |
| `MANAGER_ROLE` | RedemptionManager | Autorização para estorno manual (`cancelar`) ou processamento de vouchers vencidos (`expirar`) | Backend de Gestão / Rotina Cron |

---

## 🏷️ Motivos de Emissão (`bytes32`)

O parâmetro `motivo` é codificado em `bytes32` legível: `ethers.encodeBytes32String("SIA_15D")`.

| Código (`motivo`) | Descrição no Extrato | Condição / Critério | Valor Típico |
|---|---|---|---|
| `SIA_15D` | Acesso regular ao SIA (15 dias) | Acesso nos últimos 15 dias | 20 WC |
| `PRES_15D` | Frequência presencial regular | Alunos presenciais com $\ge 75\%$ de presença | 30 a 50 WC |
| `SIMULADO` | Participação no Simulado | Adesão ao simulado institucional | 15 a 30 WC |
| `DIG_ESTUDO` | Engajamento no Ambiente Digital | Alunos do curso Digital com acesso no ciclo | 50 WC |
| `VOLTOU` | Retomada aos Estudos (Anti-Evasão) | Alunos inativos $>30$ dias que retornaram | 100 WC |
| `CR_SEM` | Desempenho Acadêmico (CR) | Alunos com CR semestral $\ge 6.0$ | 25 a 40 WC |
| `ESTUDO_30` | *(Reservada)* 30% tempo de estudo | Validação de horas pela coordenação | 100 WC |
| `ESTUDO_SUBIU` | *(Reservada)* Tempo de estudo subiu | Evolução do tempo de estudo no período | Bônus |

---

## 🔄 Fluxo de Resgate (`RedemptionManager`)

```
   [ Aluno ]
       | (approve + resgatar)
       v
 [ Resgatado (0) ]  <-- Tokens bloqueados sob custódia do contrato
       |
       +---> [ CONFIRMER_ROLE: confirmarUso ] ---> [ Utilizado (1) ] -> Tokens queimados (burn)
       |
       +---> [ MANAGER_ROLE: cancelar ]      ---> [ Cancelado (2) ] -> Tokens devolvidos ao aluno
       |
       +---> [ MANAGER_ROLE: expirar ]       ---> [ Expirado (3) ]  -> Tokens devolvidos ao aluno (após prazo)
```

---

## 🛠️ Integração com Backend / APIs

Consulte [`scripts/backend_api.example.js`](scripts/backend_api.example.js) para exemplos práticos em JavaScript/ethers.js de:
- Consulta de saldo (`balanceOf`);
- Emissão avulsa e em lote (`mintRewardBatch`);
- Aprovação e solicitação de resgate (`approve` + `resgatar`);
- Confirmação de uso e queima (`confirmarUso`);
- Cancelamento e estorno (`cancelar`);
- Processamento de expiração (`expirar`).
