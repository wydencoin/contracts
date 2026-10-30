const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const motivo = (s) => ethers.encodeBytes32String(s);

describe("RedemptionManager", function () {
  let wc, rm, admin, minter, confirmer, manager, aluno1, aluno2, outro;

  beforeEach(async () => {
    [admin, minter, confirmer, manager, aluno1, aluno2, outro] = await ethers.getSigners();

    // Deploy WydenCoin
    wc = await ethers.deployContract("WydenCoin");
    await wc.grantRole(await wc.MINTER_ROLE(), minter.address);

    // Deploy RedemptionManager passando o endereço do WydenCoin
    rm = await ethers.deployContract("RedemptionManager", [await wc.getAddress()]);

    // Autoriza o RedemptionManager no contrato WydenCoin
    await wc.setRedemptionManager(await rm.getAddress());

    // Concede roles no RedemptionManager
    await rm.grantRole(await rm.CONFIRMER_ROLE(), confirmer.address);
    await rm.grantRole(await rm.MANAGER_ROLE(), manager.address);

    // Emite moedas para os alunos
    await wc.connect(minter).mintReward(aluno1.address, 100, motivo("SIA_15D"));
    await wc.connect(minter).mintReward(aluno2.address, 50, motivo("PRES_15D"));
  });

  it("inicializa com token correto e admin configurado", async () => {
    expect(await rm.token()).to.equal(await wc.getAddress());
    expect(await rm.hasRole(await rm.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    expect(await rm.hasRole(await rm.CONFIRMER_ROLE(), confirmer.address)).to.be.true;
    expect(await rm.hasRole(await rm.MANAGER_ROLE(), manager.address)).to.be.true;
  });

  describe("resgatar", function () {
    it("bloqueia moedas com sucesso gerando resgate pendente e evento", async () => {
      const valor = 30n;
      const beneficioId = 1n;
      const agora = BigInt(await time.latest());
      const expiraEm = agora + 86400n; // 24h

      // Aluno aprova o RedemptionManager a debitar as moedas
      await wc.connect(aluno1).approve(await rm.getAddress(), valor);

      await expect(rm.connect(aluno1).resgatar(beneficioId, valor, expiraEm))
        .to.emit(rm, "ResgateCriado")
        .withArgs(1n, aluno1.address, beneficioId, valor, expiraEm);

      // Saldo do aluno reduzido e saldo do contrato incrementado
      expect(await wc.balanceOf(aluno1.address)).to.equal(70n);
      expect(await wc.balanceOf(await rm.getAddress())).to.equal(30n);

      const resgate = await rm.resgates(1);
      expect(resgate.aluno).to.equal(aluno1.address);
      expect(resgate.beneficioId).to.equal(beneficioId);
      expect(resgate.valor).to.equal(valor);
      expect(resgate.expiraEm).to.equal(expiraEm);
      expect(resgate.status).to.equal(0n); // 0 = Resgatado
    });

    it("falha ao tentar resgatar sem aprovação suficiente", async () => {
      const agora = BigInt(await time.latest());
      const expiraEm = agora + 3600n;
      await expect(rm.connect(aluno1).resgatar(1, 30, expiraEm))
        .to.be.revertedWithCustomError(wc, "ERC20InsufficientAllowance");
    });

    it("falha ao tentar resgatar valor maior que o saldo do aluno", async () => {
      const agora = BigInt(await time.latest());
      const expiraEm = agora + 3600n;
      await wc.connect(aluno1).approve(await rm.getAddress(), 200);
      await expect(rm.connect(aluno1).resgatar(1, 200, expiraEm))
        .to.be.revertedWithCustomError(wc, "ERC20InsufficientBalance");
    });
  });

  describe("confirmarUso", function () {
    let expiraEm;

    beforeEach(async () => {
      const agora = BigInt(await time.latest());
      expiraEm = agora + 86400n;
      await wc.connect(aluno1).approve(await rm.getAddress(), 40);
      await rm.connect(aluno1).resgatar(1, 40, expiraEm);
    });

    it("queima as moedas e marca status Utilizado quando chamado por CONFIRMER_ROLE", async () => {
      const supplyAntes = await wc.totalSupply();
      await expect(rm.connect(confirmer).confirmarUso(1))
        .to.emit(rm, "ResgateUtilizado")
        .withArgs(1);

      const resgate = await rm.resgates(1);
      expect(resgate.status).to.equal(1n); // 1 = Utilizado

      // Tokens do contrato foram queimados
      expect(await wc.balanceOf(await rm.getAddress())).to.equal(0n);
      expect(await wc.totalSupply()).to.equal(supplyAntes - 40n);
    });

    it("reverte se chamado por conta sem CONFIRMER_ROLE", async () => {
      await expect(rm.connect(outro).confirmarUso(1))
        .to.be.revertedWithCustomError(rm, "AccessControlUnauthorizedAccount");
    });

    it("reverte se o resgate já expirou", async () => {
      // Avança o tempo além do prazo de expiração
      await time.increaseTo(expiraEm + 10n);

      await expect(rm.connect(confirmer).confirmarUso(1))
        .to.be.revertedWith("Resgate expirado");
    });

    it("reverte se o resgate já foi utilizado anteriormente", async () => {
      await rm.connect(confirmer).confirmarUso(1);
      await expect(rm.connect(confirmer).confirmarUso(1))
        .to.be.revertedWith("Resgate nao esta pendente");
    });
  });

  describe("cancelar", function () {
    beforeEach(async () => {
      const agora = BigInt(await time.latest());
      const expiraEm = agora + 86400n;
      await wc.connect(aluno1).approve(await rm.getAddress(), 40);
      await rm.connect(aluno1).resgatar(1, 40, expiraEm);
    });

    it("cancela e restitui o saldo integral do aluno quando chamado por MANAGER_ROLE", async () => {
      await expect(rm.connect(manager).cancelar(1))
        .to.emit(rm, "ResgateCancelado")
        .withArgs(1);

      const resgate = await rm.resgates(1);
      expect(resgate.status).to.equal(2n); // 2 = Cancelado
      expect(await wc.balanceOf(aluno1.address)).to.equal(100n);
      expect(await wc.balanceOf(await rm.getAddress())).to.equal(0n);
    });

    it("reverte se chamado por conta sem MANAGER_ROLE", async () => {
      await expect(rm.connect(aluno1).cancelar(1))
        .to.be.revertedWithCustomError(rm, "AccessControlUnauthorizedAccount");
    });

    it("reverte se o resgate não estiver no status pendente", async () => {
      await rm.connect(manager).cancelar(1);
      await expect(rm.connect(manager).cancelar(1))
        .to.be.revertedWith("Resgate nao pendente");
    });
  });

  describe("expirar", function () {
    let expiraEm;

    beforeEach(async () => {
      const agora = BigInt(await time.latest());
      expiraEm = agora + 3600n; // 1 hora
      await wc.connect(aluno1).approve(await rm.getAddress(), 25);
      await rm.connect(aluno1).resgatar(1, 25, expiraEm);
    });

    it("reverte se tentado expirar ainda dentro do prazo de validade", async () => {
      await expect(rm.connect(manager).expirar(1))
        .to.be.revertedWith("Ainda no prazo");
    });

    it("restitui as moedas ao aluno após o decurso do prazo", async () => {
      await time.increaseTo(expiraEm + 1n);

      await expect(rm.connect(manager).expirar(1))
        .to.emit(rm, "ResgateExpirado")
        .withArgs(1);

      const resgate = await rm.resgates(1);
      expect(resgate.status).to.equal(3n); // 3 = Expirado
      expect(await wc.balanceOf(aluno1.address)).to.equal(100n);
      expect(await wc.balanceOf(await rm.getAddress())).to.equal(0n);
    });

    it("reverte se chamado por conta sem MANAGER_ROLE", async () => {
      await time.increaseTo(expiraEm + 1n);
      await expect(rm.connect(outro).expirar(1))
        .to.be.revertedWithCustomError(rm, "AccessControlUnauthorizedAccount");
    });
  });
});
