const { expect } = require("chai");
const { ethers } = require("hardhat");

const motivo = (s) => ethers.encodeBytes32String(s);

describe("WydenCoin", function () {
  let wc, admin, minter, rm, aluno1, aluno2, outro;

  beforeEach(async () => {
    [admin, minter, rm, aluno1, aluno2, outro] = await ethers.getSigners();
    wc = await ethers.deployContract("WydenCoin");
    await wc.grantRole(await wc.MINTER_ROLE(), minter.address);
    await wc.setRedemptionManager(rm.address); // RM simulado por uma conta comum
  });

  it("tem nome, símbolo e 0 casas decimais", async () => {
    expect(await wc.name()).to.equal("WydenCoin");
    expect(await wc.symbol()).to.equal("WC");
    expect(await wc.decimals()).to.equal(0n);
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

  // ---- Comportamentos para discutir (passam hoje, mas merecem decisão) ----

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
    const signers = await ethers.getSigners();
    const alunos = Array.from({ length: 100 }, (_, i) => ethers.Wallet.createRandom().address);
    const tx = await wc.connect(minter).mintRewardBatch(alunos, alunos.map(() => 20), alunos.map(() => motivo("SIA_15D")));
    const rc = await tx.wait();
    console.log("      gas lote 100:", rc.gasUsed.toString());
  });
});
