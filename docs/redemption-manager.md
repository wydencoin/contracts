# Especificação do RedemptionManager (v0, 30/10/2026)

O `RedemptionManager` gerencia o ciclo de vida completo dos vouchers de resgate de benefícios adquiridos com tokens WydenCoin (WC).

## 1. Motivação e Arquitetura

Na regra do WydenCoin, as transferências diretas P2P entre alunos são bloqueadas no hook `_update` do `WydenCoin.sol`. O `RedemptionManager` atua como o intermediador custodial autorizado para:
1. Bloquear o saldo no ato da emissão do voucher de benefício;
2. Efetuar o burn permanente do saldo após o consumo efetivo do benefício;
3. Restituir os tokens ao aluno caso a solicitação seja cancelada ou expire por decurso de prazo.

## 2. Máquina de Estados do Resgate

| Status | Código Numérico | Descrição | Transições Permitidas |
|---|---|---|---|
| `Resgatado` | `0` | Moedas debitadas da carteira do aluno e custodiadas no contrato | $\to$ `Utilizado`, $\to$ `Cancelado`, $\to$ `Expirado` |
| `Utilizado` | `1` | Benefício consumido pelo aluno; moedas foram destruídas via `burn` | Estado Final |
| `Cancelado` | `2` | Operação cancelada administrativamente; moedas devolvidas ao aluno | Estado Final |
| `Expirado` | `3` | Prazo limite excedido (`block.timestamp > expiraEm`); moedas devolvidas ao aluno | Estado Final |

## 3. Matriz de Permissões

- `DEFAULT_ADMIN_ROLE`: Configura e concede papéis operacionais.
- `CONFIRMER_ROLE`: Papel operacional para operadores de cantina, parceiros ou serviços de validação de QR Code/voucher para chamar `confirmarUso(id)`.
- `MANAGER_ROLE`: Papel atribuído à API gestora ou rotinas agendadas (cron) para invocar `cancelar(id)` ou `expirar(id)`.

## 4. Testes Automatizados

A suíte em `test/RedemptionManager.test.js` cobre:
- Bloqueio com retenção do saldo e emissão do evento `ResgateCriado`;
- Tentativa de resgate sem aprovação ou com saldo insuficiente;
- Confirmação com validação de role e verificação da queima (`totalSupply` e saldo do contrato);
- Rejeição de confirmação após data de expiração;
- Cancelamento e estorno imediato com `MANAGER_ROLE`;
- Expiração temporal usando manipulação de blocos de tempo (`hardhat-network-helpers`);
- Proteções contra execução repetida de chamadas (reentrância/estado não-pendente).
