# contracts — WydenCoin

Contratos Solidity do WydenCoin. Responsável: **Carlos Mikael**.

| Contrato | Estado |
| --- | --- |
| `WydenCoin.sol` — ERC-20, 0 decimais, emissão com motivo, lote, transferência entre alunos bloqueada | v0 testado |
| `RedemptionManager.sol` — resgate: bloquear, confirmar (queimar), cancelar/expirar (devolver) | a fazer (Sprint 1) |

## Rodar
```bash
npm ci
npx hardhat test          # testes
npx hardhat node          # blockchain local para a API em desenvolvimento
npm run deploy:local      # deploy na blockchain local
```
Deploy no Besu: copie `.env.example` para `.env` e rode `npm run deploy:besu`.

## Motivo de emissão
O `motivo` é o código da regra em `bytes32` legível: `ethers.encodeBytes32String("SIA_15D")`. A lista de códigos está no repositório **docs** (`regras/regras-v0.md`).

Veja `docs/revisao-v0.md` para os ajustes sugeridos na primeira revisão.
