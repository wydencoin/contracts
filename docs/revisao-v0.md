# Revisão do WydenCoin.sol (v0, 27/10/2026)

Compilado com Solidity 0.8.24 e OpenZeppelin 5; **11 testes passando** (`test/WydenCoin.test.js`).

## O que está bom
- Papéis separados (`DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`) e emissão com motivo em evento.
- `decimals() = 0`: 1 WC = 1 inteiro, simples para front e UX.
- Emissão em lote com checagem de tamanho dos arrays.
- Bloqueio de transferência entre alunos no `_update`, liberando mint, burn e o RedemptionManager.

## Ajustes sugeridos (viram issues)
1. **Aluno consegue enviar moedas direto ao RedemptionManager** (`to == redemptionManager`) sem resgate registrado — as moedas ficam presas. Sugestão: permitir só `msg.sender == redemptionManager` (o RM puxa com `transferFrom`).
2. **`ERC20Burnable` deixa o aluno queimar o próprio saldo.** Sem risco para a instituição, mas some com as moedas sem registro. Decidir se fica; o RM pode queimar com `_burn` via função própria.
3. **Sem freio de emergência.** Se a chave de emissão vazar, não há como parar. Sugestão: `ERC20Pausable` (pausar emissões/resgates) e um teto por chamada em `mintRewardBatch`.
4. **`setRedemptionManager` sem evento.** Emitir um evento facilita a auditoria e o indexador.
5. **Tamanho do lote.** 100 alunos gastaram ~2,8 milhões de gas no teste. A API divide em lotes de 100; o `gasLimit` do bloco no genesis do Besu precisa comportar isso.
6. **Fluxo de resgate exige `approve` do aluno.** Com carteira custodial a API assina o `approve`; avaliar `ERC20Permit` para reduzir a uma transação.
7. **Próximo passo:** o `RedemptionManager` (bloquear → confirmar/queimar → cancelar/expirar devolve).
