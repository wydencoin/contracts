// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract WydenCoin is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant DIRECTOR_ROLE = keccak256("DIRECTOR_ROLE");

    uint64 public constant PERIODO_EXPIRACAO_PADRAO = 365 days;

    struct Lote {
        uint128 valor;
        uint64 recebidoEm;
        uint64 expiraEm; // 0 indica lote sem expiracao
    }

    address public redemptionManager;
    uint64 public periodoExpiracao = PERIODO_EXPIRACAO_PADRAO;

    mapping(address => Lote[]) private _lotes;
    mapping(address => uint256) private _inicioLote;
    bool private _purgando;

    event RewardMinted(address indexed aluno, uint256 valor, bytes32 motivo);
    event LoteCriado(address indexed aluno, uint256 valor, uint64 recebidoEm, uint64 expiraEm);
    event TokensExpirados(address indexed aluno, uint256 valorQueimado);
    event PeriodoExpiracaoAtualizado(uint64 periodoAnterior, uint64 novoPeriodo, address indexed atualizadoPor);
    event RedemptionManagerAtualizado(address indexed anterior, address indexed novo);

    constructor() ERC20("WydenCoin", "WC") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DIRECTOR_ROLE, msg.sender);
    }

    // Define o endereco do contrato de resgate autorizado
    function setRedemptionManager(address _redemptionManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_redemptionManager != address(0), "WydenCoin: endereco invalido");
        address anterior = redemptionManager;
        redemptionManager = _redemptionManager;
        emit RedemptionManagerAtualizado(anterior, _redemptionManager);
    }

    // Altera o prazo de expiracao (em segundos) aplicado as novas emissoes.
    // Informe 0 para desativar expiracao em novos lotes.
    function setPeriodoExpiracao(uint64 novoPeriodo) external onlyRole(DIRECTOR_ROLE) {
        uint64 anterior = periodoExpiracao;
        periodoExpiracao = novoPeriodo;
        emit PeriodoExpiracaoAtualizado(anterior, novoPeriodo, msg.sender);
    }

    // 0 casas decimais (1 WC = 1 inteiro)
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    // Retorna o saldo valido descontando lotes ja vencidos em tempo real
    function balanceOf(address account) public view override returns (uint256) {
        uint256 bruto = super.balanceOf(account);
        if (account == redemptionManager) {
            return bruto;
        }
        uint256 expirado = saldoExpiravel(account);
        return bruto > expirado ? bruto - expirado : 0;
    }

    // Retorna o total de moedas vencidas pendentes de queima on-chain para a conta
    function saldoExpiravel(address conta) public view returns (uint256 total) {
        if (conta == redemptionManager) {
            return 0;
        }
        Lote[] storage lotes = _lotes[conta];
        uint256 head = _inicioLote[conta];
        uint256 len = lotes.length;

        while (head < len && _loteExpirado(lotes[head])) {
            total += lotes[head].valor;
            head++;
        }
    }

    // Retorna os lotes ainda validos da conta ordenados por vencimento mais proximo (FEFO)
    function lotesAtivos(address conta) external view returns (Lote[] memory) {
        if (conta == redemptionManager) {
            return new Lote[](0);
        }
        Lote[] storage lotes = _lotes[conta];
        uint256 head = _inicioLote[conta];
        uint256 len = lotes.length;

        while (head < len && _loteExpirado(lotes[head])) {
            head++;
        }

        uint256 qtd = len - head;
        Lote[] memory ativos = new Lote[](qtd);
        for (uint256 i = 0; i < qtd; i++) {
            ativos[i] = lotes[head + i];
        }
        return ativos;
    }

    // Queima efetivamente os lotes expirados de uma conta (reduzindo totalSupply)
    function expirarSaldo(address conta) external returns (uint256 valorQueimado) {
        return _purgarExpirados(conta);
    }

    // Queima lotes expirados de multiplas contas em uma unica transacao (rotina cron)
    function expirarSaldoBatch(address[] calldata contas) external returns (uint256 totalQueimado) {
        for (uint256 i = 0; i < contas.length; i++) {
            totalQueimado += _purgarExpirados(contas[i]);
        }
    }

    // Emissao individual de recompensas
    function mintReward(address aluno, uint256 valor, bytes32 motivo) external onlyRole(MINTER_ROLE) {
        _mint(aluno, valor);
        emit RewardMinted(aluno, valor, motivo);
    }

    // Emissao atomica em lote
    function mintRewardBatch(
        address[] calldata alunos,
        uint256[] calldata valores,
        bytes32[] calldata motivos
    ) external onlyRole(MINTER_ROLE) {
        require(
            alunos.length == valores.length && valores.length == motivos.length,
            "WydenCoin: arrays devem ter o mesmo tamanho"
        );
        for (uint256 i = 0; i < alunos.length; i++) {
            _mint(alunos[i], valores[i]);
            emit RewardMinted(alunos[i], valores[i], motivos[i]);
        }
    }

    // Hook de atualizacao de saldo: bloqueia transferencias P2P e sincroniza lotes FEFO
    function _update(address from, address to, uint256 value) internal override {
        if (_purgando) {
            super._update(from, to, value);
            return;
        }

        if (from != address(0) && to != address(0)) {
            require(
                msg.sender == redemptionManager || to == redemptionManager || from == redemptionManager,
                "WydenCoin: transferencias diretas entre alunos estao bloqueadas"
            );
        }

        bool fromEhUsuario = from != address(0) && from != redemptionManager;
        bool toEhUsuario = to != address(0) && to != redemptionManager;

        if (fromEhUsuario) {
            _purgarExpirados(from);
        }
        if (toEhUsuario && to != from) {
            _purgarExpirados(to);
        }

        super._update(from, to, value);

        if (fromEhUsuario && value > 0) {
            _consumirLotes(from, value);
        }
        if (toEhUsuario && value > 0) {
            _adicionarLote(to, value, _calcularExpiracao());
        }
    }

    function _calcularExpiracao() private view returns (uint64) {
        if (periodoExpiracao == 0) {
            return 0;
        }
        return uint64(block.timestamp) + periodoExpiracao;
    }

    function _loteExpirado(Lote storage lote) private view returns (bool) {
        return lote.expiraEm != 0 && block.timestamp >= lote.expiraEm;
    }

    function _chaveOrdenacao(uint64 expiraEm) private pure returns (uint64) {
        return expiraEm == 0 ? type(uint64).max : expiraEm;
    }

    function _purgarExpirados(address conta) private returns (uint256 totalExpirado) {
        if (conta == address(0) || conta == redemptionManager) {
            return 0;
        }

        Lote[] storage lotes = _lotes[conta];
        uint256 head = _inicioLote[conta];
        uint256 len = lotes.length;

        while (head < len && _loteExpirado(lotes[head])) {
            totalExpirado += lotes[head].valor;
            delete lotes[head];
            head++;
        }

        if (totalExpirado == 0) {
            return 0;
        }

        _inicioLote[conta] = head;
        _purgando = true;
        _burn(conta, totalExpirado);
        _purgando = false;

        emit TokensExpirados(conta, totalExpirado);
    }

    function _adicionarLote(address conta, uint256 valor, uint64 expiraEm) private {
        require(valor <= type(uint128).max, "WydenCoin: valor excede limite do lote");
        Lote[] storage lotes = _lotes[conta];
        uint256 head = _inicioLote[conta];
        uint256 len = lotes.length;

        // Otimizacao: agrupa recompensas recebidas com a mesma data de vencimento (mesmo bloco/lote)
        if (len > head && lotes[len - 1].expiraEm == expiraEm) {
            uint256 soma = uint256(lotes[len - 1].valor) + valor;
            require(soma <= type(uint128).max, "WydenCoin: saldo excede limite do lote");
            lotes[len - 1].valor = uint128(soma);
            emit LoteCriado(conta, valor, uint64(block.timestamp), expiraEm);
            return;
        }

        lotes.push(Lote({
            valor: uint128(valor),
            recebidoEm: uint64(block.timestamp),
            expiraEm: expiraEm
        }));

        uint256 idx = len;
        uint64 chaveNova = _chaveOrdenacao(expiraEm);

        while (idx > head && _chaveOrdenacao(lotes[idx - 1].expiraEm) > chaveNova) {
            Lote memory anterior = lotes[idx - 1];
            lotes[idx - 1] = lotes[idx];
            lotes[idx] = anterior;
            idx--;
        }

        emit LoteCriado(conta, valor, uint64(block.timestamp), expiraEm);
    }

    function _consumirLotes(address conta, uint256 quantidade) private {
        Lote[] storage lotes = _lotes[conta];
        uint256 head = _inicioLote[conta];
        uint256 len = lotes.length;
        uint256 restante = quantidade;

        while (restante > 0 && head < len) {
            Lote storage lote = lotes[head];
            if (lote.valor <= restante) {
                restante -= lote.valor;
                delete lotes[head];
                head++;
            } else {
                lote.valor -= uint128(restante);
                restante = 0;
            }
        }

        _inicioLote[conta] = head;
    }
}
