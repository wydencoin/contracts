const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const motivo = (s) => ethers.encodeBytes32String(s);
const UM_DIA = 86400n;
const UM_ANO = 365n * UM_DIA;

describe("WydenCoin", function () {
  let wc, admin, minter, director, rm, aluno1, aluno2, outro;

  beforeEach(async () => {
    [admin, minter, director, rm, aluno1, aluno2, outro] = await ethers.getSigners();
    wc = await ethers.deployContract("WydenCoin");
    await wc.grantRole(await wc.MINTER_ROLE(), minter.address);
    await wc.grantRole(await wc.DIRECTOR_ROLE(), director.address);
    await wc.setRedemptionManager(rm.address); // RM simulado por uma conta comum
  });

  it("tem nome, símbolo, 0 casas decimais e prazo padrão de 365 dias", async () => {
    expect(await wc.name()).to.equal("WydenCoin");
    expect(await wc.symbol()).to.equal("WC");
    expect(await wc.decimals()).to.equal(0n);
    expect(await wc.periodoExpiracao()).to.equal(UM_ANO);
  });

  it("emite com motivo legível e registra o evento", async () => {
    await expect(wc.connect(minter).mintReward(aluno1.address, 20, motivo("SIA_15D")))
      .to.emit(wc, "RewardMinted").withArgs(aluno1.address, 20, motivo("SIA_15D"));
    expect(await wc.balanceOf(aluno1.address)).to.equal(20n);
    expect(ethers.decodeBytes32String(motivo("SIA_15D"))).to.equal("SIA_15D");
  });

  it("bloqueia emissão por quem não tem MINTER_ROLE", async () => {
    await expect(wc.connect(outro).mintReward(aluno1.address, 20, motivo("SIA_15D")))
      .to.be.revertedWithCustomError(wc, "AccessControlUnauthorizedAccount");
  });

  it("emite em lote e recusa arrays de tamanhos diferentes", async () => {
    await wc.connect(minter).mintRewardBatch(
      [aluno1.address, aluno2.address], [20, 40], [motivo("SIA_15D"), motivo("PRES_100")]);
    expect(await wc.balanceOf(aluno2.address)).to.equal(40n);
    await expect(wc.connect(minter).mintRewardBatch([aluno1.address], [20, 40], [motivo("X")]))
      .to.be.revertedWith("WydenCoin: arrays devem ter o mesmo tamanho");
  });

  it("bloqueia transferência direta entre alunos", async () => {
    await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIM_FEZ"));
    await expect(wc.connect(aluno1).transfer(aluno2.address, 10))
      .to.be.revertedWith("WydenCoin: transferencias diretas entre alunos estao bloqueadas");
  });

  it("permite ao RedemptionManager puxar moedas com aprovação", async () => {
    await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIM_FEZ"));
    await wc.connect(aluno1).approve(rm.address, 30);
    await wc.connect(rm).transferFrom(aluno1.address, rm.address, 30);
    expect(await wc.balanceOf(rm.address)).to.equal(30n);
  });

  it("RedemptionManager NÃO move moedas sem aprovação", async () => {
    await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIM_FEZ"));
    await expect(wc.connect(rm).transferFrom(aluno1.address, rm.address, 30))
      .to.be.revertedWithCustomError(wc, "ERC20InsufficientAllowance");
  });

  // ---- Regras de Expiração por Lote e Governança do Diretor ----

  describe("Expiração por Lote e Controle do Diretor", function () {
    it("queima apenas os 60 WC recebidos há 1 ano, preservando os 440 WC recentes", async () => {
      await wc.connect(minter).mintReward(aluno1.address, 60, motivo("SIA_15D"));

      // 180 dias depois, recebe mais 440 WC (total 500 WC)
      await time.increase(180n * UM_DIA);
      await wc.connect(minter).mintReward(aluno1.address, 440, motivo("PRES_15D"));

      expect(await wc.balanceOf(aluno1.address)).to.equal(500n);
      expect(await wc.totalSupply()).to.equal(500n);
      expect(await wc.saldoExpiravel(aluno1.address)).to.equal(0n);

      // Avança mais 185 dias (total 365 dias desde o primeiro lote de 60 WC)
      await time.increase(185n * UM_DIA);

      // balanceOf já reflete imediatamente apenas o saldo válido (440 WC)
      expect(await wc.balanceOf(aluno1.address)).to.equal(440n);
      expect(await wc.saldoExpiravel(aluno1.address)).to.equal(60n);

      const ativos = await wc.lotesAtivos(aluno1.address);
      expect(ativos.length).to.equal(1);
      expect(ativos[0].valor).to.equal(440n);

      // Execução da queima on-chain reduz totalSupply em exatamente 60 WC
      await expect(wc.connect(outro).expirarSaldo(aluno1.address))
        .to.emit(wc, "TokensExpirados")
        .withArgs(aluno1.address, 60n);

      expect(await wc.totalSupply()).to.equal(440n);
      expect(await wc.balanceOf(aluno1.address)).to.equal(440n);
      expect(await wc.saldoExpiravel(aluno1.address)).to.equal(0n);
    });

    it("consome lotes mais antigos primeiro (FEFO) ao resgatar, reduzindo o valor expirável", async () => {
      await wc.connect(minter).mintReward(aluno1.address, 60, motivo("SIA_15D"));
      await time.increase(100n * UM_DIA);
      await wc.connect(minter).mintReward(aluno1.address, 440, motivo("PRES_15D"));

      // Aluno gasta 40 WC antes de 1 ano -> desconta do lote de 60 WC (restam 20 WC nele)
      await wc.connect(aluno1).approve(rm.address, 40);
      await wc.connect(rm).transferFrom(aluno1.address, rm.address, 40);
      expect(await wc.balanceOf(aluno1.address)).to.equal(460n);

      // Completa 1 ano desde o primeiro lote -> apenas os 20 WC remanescentes expiram
      await time.increase(265n * UM_DIA);
      expect(await wc.balanceOf(aluno1.address)).to.equal(440n);
      expect(await wc.saldoExpiravel(aluno1.address)).to.equal(20n);

      await expect(wc.expirarSaldo(aluno1.address))
        .to.emit(wc, "TokensExpirados")
        .withArgs(aluno1.address, 20n);
      expect(await wc.balanceOf(aluno1.address)).to.equal(440n);
    });

    it("impede aluno de gastar moedas já expiradas e queima automaticamente na tentativa válida", async () => {
      await wc.connect(minter).mintReward(aluno1.address, 60, motivo("SIA_15D"));
      await time.increase(180n * UM_DIA);
      await wc.connect(minter).mintReward(aluno1.address, 100, motivo("PRES_15D"));

      // Passa de 365 dias -> 60 WC vencidos, restam 100 WC válidos
      await time.increase(186n * UM_DIA);
      await wc.connect(aluno1).approve(rm.address, 150);

      // Tentar resgatar 120 WC falha pois apenas 100 WC são válidos
      await expect(wc.connect(rm).transferFrom(aluno1.address, rm.address, 120))
        .to.be.revertedWithCustomError(wc, "ERC20InsufficientBalance");

      // Resgatar 50 WC funciona e purga automaticamente os 60 WC expirados
      await expect(wc.connect(rm).transferFrom(aluno1.address, rm.address, 50))
        .to.emit(wc, "TokensExpirados")
        .withArgs(aluno1.address, 60n);

      expect(await wc.balanceOf(aluno1.address)).to.equal(50n);
      expect(await wc.totalSupply()).to.equal(100n); // 50 aluno1 + 50 rm
    });

    it("permite ao diretor alterar o prazo apenas para novas emissões e mantém ordenação FEFO", async () => {
      // Lote 1 com prazo padrão (365 dias)
      await wc.connect(minter).mintReward(aluno1.address, 60, motivo("SIA_15D"));

      // Diretor reduz prazo para 30 dias (somente novas emissões)
      await expect(wc.connect(director).setPeriodoExpiracao(30n * UM_DIA))
        .to.emit(wc, "PeriodoExpiracaoAtualizado")
        .withArgs(UM_ANO, 30n * UM_DIA, director.address);

      await time.increase(10n * UM_DIA);
      // Lote 2 com prazo de 30 dias (vence no dia 40 — ANTES do Lote 1 que vence no dia 365)
      await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIMULADO"));

      const ativosAntes = await wc.lotesAtivos(aluno1.address);
      expect(ativosAntes.length).to.equal(2);
      // FEFO: Lote 2 (vence dia 40) vem primeiro na fila
      expect(ativosAntes[0].valor).to.equal(100n);
      expect(ativosAntes[1].valor).to.equal(60n);

      // No dia 41, apenas os 100 WC (Lote 2) expiram; os 60 WC antigos (Lote 1) permanecem intactos
      await time.increase(31n * UM_DIA);
      expect(await wc.balanceOf(aluno1.address)).to.equal(60n);
      expect(await wc.saldoExpiravel(aluno1.address)).to.equal(100n);

      await expect(wc.expirarSaldo(aluno1.address))
        .to.emit(wc, "TokensExpirados")
        .withArgs(aluno1.address, 100n);
      expect(await wc.balanceOf(aluno1.address)).to.equal(60n);
    });

    it("permite ao diretor desativar expiração definindo prazo como 0 para novas emissões", async () => {
      await wc.connect(director).setPeriodoExpiracao(0);
      await wc.connect(minter).mintReward(aluno1.address, 200, motivo("CR_SEM"));

      // Mesmo após 5 anos, lote com expiraEm == 0 não expira
      await time.increase(5n * UM_ANO);
      expect(await wc.balanceOf(aluno1.address)).to.equal(200n);
      expect(await wc.saldoExpiravel(aluno1.address)).to.equal(0n);
    });

    it("bloqueia alteração de período por contas sem DIRECTOR_ROLE", async () => {
      await expect(wc.connect(outro).setPeriodoExpiracao(180n * UM_DIA))
        .to.be.revertedWithCustomError(wc, "AccessControlUnauthorizedAccount");
      await expect(wc.connect(minter).setPeriodoExpiracao(180n * UM_DIA))
        .to.be.revertedWithCustomError(wc, "AccessControlUnauthorizedAccount");
    });

    it("executa expirarSaldoBatch para múltiplos alunos em uma única transação", async () => {
      await wc.connect(minter).mintReward(aluno1.address, 60, motivo("SIA_15D"));
      await wc.connect(minter).mintReward(aluno2.address, 40, motivo("PRES_15D"));

      await time.increase(UM_ANO + 1n);

      await expect(wc.expirarSaldoBatch([aluno1.address, aluno2.address, outro.address]))
        .to.emit(wc, "TokensExpirados").withArgs(aluno1.address, 60n)
        .and.to.emit(wc, "TokensExpirados").withArgs(aluno2.address, 40n);

      expect(await wc.totalSupply()).to.equal(0n);
    });

    it("não expira moedas custodiadas no RedemptionManager", async () => {
      await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIA_15D"));
      await wc.connect(aluno1).approve(rm.address, 100);
      await wc.connect(rm).transferFrom(aluno1.address, rm.address, 100);

      await time.increase(2n * UM_ANO);
      expect(await wc.balanceOf(rm.address)).to.equal(100n);
      expect(await wc.saldoExpiravel(rm.address)).to.equal(0n);
    });
  });

  // ---- Comportamentos existentes preservados ----

  it("[atenção] aluno consegue enviar moedas direto ao RedemptionManager, sem resgate registrado", async () => {
    await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIM_FEZ"));
    await wc.connect(aluno1).transfer(rm.address, 50);
    expect(await wc.balanceOf(rm.address)).to.equal(50n);
  });

  it("[atenção] aluno consegue queimar as próprias moedas (ERC20Burnable)", async () => {
    await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIM_FEZ"));
    await wc.connect(aluno1).burn(100);
    expect(await wc.balanceOf(aluno1.address)).to.equal(0n);
  });

  it("[atenção] sem RedemptionManager definido, ninguém transfere (inclusive o resgate)", async () => {
    const wc2 = await ethers.deployContract("WydenCoin");
    await wc2.grantRole(await wc2.MINTER_ROLE(), minter.address);
    await wc2.connect(minter).mintReward(aluno1.address, 10, motivo("SIA_15D"));
    await expect(wc2.connect(aluno1).transfer(aluno2.address, 1)).to.be.reverted;
  });

  it("[medida] gas de um lote de 100 alunos", async () => {
    const alunos = Array.from({ length: 100 }, () => ethers.Wallet.createRandom().address);
    const tx = await wc.connect(minter).mintRewardBatch(alunos, alunos.map(() => 20), alunos.map(() => motivo("SIA_15D")));
    const rc = await tx.wait();
    console.log("      gas lote 100:", rc.gasUsed.toString());
  });
});
