# Contratos Inteligentes — WydenCoin

Contratos Solidity, suíte de testes Hardhat e scripts de implantação da arquitetura **WydenCoin**.

| Contrato | Descrição | Testes |
| :--- | :--- | :--- |
| [`WydenCoin.sol`](contracts/WydenCoin.sol) | Token ERC-20 (`WC`), 0 casas decimais, emissão com motivo (`bytes32`), emissão atômica em lote, expiração individual por lote (FEFO) com prazo configurável e bloqueio de transferências P2P entre alunos | `test/WydenCoin.test.js` |
| [`RedemptionManager.sol`](contracts/RedemptionManager.sol) | Gestão do ciclo de vida de vouchers: custódia no resgate, queima (`burn`) na confirmação de uso, e restituição em cancelamento ou expiração | `test/RedemptionManager.test.js` |

Documentação complementar em `docs/`:
* [Especificação do RedemptionManager](docs/redemption-manager.md)
* [Revisão técnica v0 do WydenCoin](docs/revisao-v0.md)

---

## Endereços Implantados (Rede Besu QBFT)

* **RPC Endpoint:** `http://wydencoin-rpc.duckdns.org:8545` (acesso direto em rede autorizada) / `http://wydencoin-rpc.duckdns.org:8546` (via RPC Gateway autenticado)
* **Chain ID:** `381660001` (`0x16bfab61`)
* **Consenso:** QBFT (blocos a cada 2 segundos, `min-gas-price=0`)

| Contrato | Endereço |
| :--- | :--- |
| `WydenCoin` (`WC`) | `0xa50a51c09a5c451C52BB714527E1974b686D8e77` |
| `RedemptionManager` | `0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e` |

---

## Execução Local e Testes

### Instalação de Dependências

```bash
npm ci
```

### Suíte de Testes Automatizados

```bash
npm test
# ou
npx hardhat test
```

A suíte executa 26 testes cobrindo controle de acesso, validações de saldo e aprovação, reversões, expiração temporal e simulação de emissão quinzenal em lote (213 emissões para 66 alunos).

### Nó Local Hardhat

```bash
npx hardhat node
```

### Deploy dos Contratos

**Em ambiente local (Hardhat):**
```bash
npm run deploy:local
```

**Na rede Hyperledger Besu:**
1. Crie o arquivo `.env` a partir do modelo:
   ```bash
   cp .env.example .env
   ```
2. Configure `DEPLOYER_PRIVATE_KEY` e demais endereços opcionais de roles.
3. Execute o deploy:
   ```bash
   npm run deploy:besu
   ```

Os endereços implantados são gravados automaticamente em `addresses.json`.

---

## Papéis e Controle de Acesso (`AccessControl`)

| Papel | Contrato | Finalidade | Destinatário |
| :--- | :--- | :--- | :--- |
| `DEFAULT_ADMIN_ROLE` | `WydenCoin` e `RedemptionManager` | Administração de roles e vínculo do `RedemptionManager` (`setRedemptionManager`) | Conta de Governança / Deployer |
| `MINTER_ROLE` | `WydenCoin` | Emissão individual (`mintReward`) e em lote (`mintRewardBatch`) | Backend / Motor de Recompensas |
| `DIRECTOR_ROLE` | `WydenCoin` | Alteração do prazo de expiração das moedas (`setPeriodoExpiracao`) para novas emissões | Diretoria / Governança |
| `CONFIRMER_ROLE` | `RedemptionManager` | Validação operacional do voucher e queima definitiva das moedas (`confirmarUso`) | API dos Estabelecimentos |
| `MANAGER_ROLE` | `RedemptionManager` | Cancelamento administrativo (`cancelar`) e estorno por vencimento (`expirar`) | API de Gestão / Rotina Cron |

---

## Códigos de Motivo de Emissão (`bytes32`)

O parâmetro `motivo` é codificado em `bytes32` legível via `ethers.encodeBytes32String("<CODIGO>")`:

| Código (`motivo`) | Descrição | Critério | Referência |
| :--- | :--- | :--- | :--- |
| `SIA_15D` | Acesso regular ao SIA (15 dias) | Acesso no ciclo de 15 dias | 20 WC |
| `PRES_15D` | Frequência presencial regular | Presença $\ge 75\%$ no ciclo | 30 a 50 WC |
| `SIMULADO` | Participação no simulado | Adesão ao simulado institucional | 15 a 30 WC |
| `DIG_ESTUDO` | Engajamento no ambiente digital | Acesso no ciclo em cursos digitais | 50 WC |
| `VOLTOU` | Retomada de estudos | Retorno após inatividade $> 30$ dias | 100 WC |
| `CR_SEM` | Desempenho acadêmico (CR) | CR semestral $\ge 6.0$ | 25 a 40 WC |
| `ESTUDO_30` | *(Reservado)* 30% tempo de estudo | Validação de horas pela coordenação | 100 WC |
| `ESTUDO_SUBIU` | *(Reservado)* Evolução do tempo de estudo | Crescimento no período avaliado | Bônus |

---

## Expiração por Lote e Governança do Prazo

Cada recebimento de WydenCoin registra um lote próprio na carteira do aluno contendo quantidade, data de recebimento e data de expiração (`expiraEm = block.timestamp + periodoExpiracao`), com prazo padrão inicial de **365 dias**.

* **Expiração isolada por lote:** quando um lote atinge `expiraEm`, somente o saldo remanescente daquele lote expira; moedas recebidas posteriormente permanecem válidas até suas respectivas datas.
* **Consumo FEFO (*First-Expired, First-Out*):** ao resgatar benefícios, os tokens mais próximos do vencimento são consumidos primeiro.
* **Alteração de prazo (`DIRECTOR_ROLE`):** contas autorizadas com `DIRECTOR_ROLE` podem alterar o prazo via `setPeriodoExpiracao(uint64 novoPeriodo)` (ou definir `0` para desativar). A alteração vale exclusivamente para **novas emissões**, preservando a data de validade dos lotes já creditados.
* **Queima on-chain (`_burn`):** `balanceOf(aluno)` desconta imediatamente lotes vencidos; a queima efetiva (redução de `totalSupply` e evento `TokensExpirados`) ocorre automaticamente em movimentações da carteira ou sob demanda via `expirarSaldo(aluno)` e `expirarSaldoBatch(alunos[])`.

---

## Fluxo do Ciclo de Resgate (`RedemptionManager`)

```text
[ Aluno ]
    | (approve + resgatar)
    v
[ Resgatado (0) ]  <-- Tokens bloqueados sob custódia do contrato
    |
    +---> [ CONFIRMER_ROLE: confirmarUso ] ---> [ Utilizado (1) ] -> Tokens queimados (burn)
    |
    +---> [ MANAGER_ROLE: cancelar ]       ---> [ Cancelado (2) ] -> Tokens devolvidos ao aluno
    |
    +---> [ MANAGER_ROLE: expirar ]        ---> [ Expirado (3) ]  -> Tokens devolvidos ao aluno (após prazo)
```

---

## Integração com Aplicações e Backend

A documentação canônica de integração via API REST e SDK cliente reside no repositório `wydencoin/infra`:

* **Arquitetura e operação do Gateway:** `infra/gateway/GATEWAY_API.md`
* **Especificação de chamadas HTTP/JSON (cURL, Python, Dart, fetch):** `infra/gateway/GUIA_CHAMADAS_JSON.md`
* **Guia do cliente SDK JavaScript:** `infra/gateway/GUIA_CHAMADAS_GATEWAY_CLIENT.md`

Exemplos executáveis disponíveis neste repositório:
* Cliente REST via Gateway: [`scripts/gateway_client.example.js`](scripts/gateway_client.example.js)
* Integração direta via `ethers.js`: [`scripts/backend_api.example.js`](scripts/backend_api.example.js)
