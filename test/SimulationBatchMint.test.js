const { expect } = require("chai");
const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");

function getStudentWallet(matricula) {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(matricula));
  return new ethers.Wallet(hash).address;
}

describe("Simulação Quinzenal de Emissão em Lote (mintRewardBatch)", function () {
  let wc, admin, minter;
  let simulacao;

  before(async () => {
    const fixturePath = path.join(__dirname, "fixtures", "simulacao_recompensas.json");
    simulacao = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  });

  beforeEach(async () => {
    [admin, minter] = await ethers.getSigners();
    wc = await ethers.deployContract("WydenCoin");
    await wc.grantRole(await wc.MINTER_ROLE(), minter.address);
  });

  it("processa com sucesso lote quinzenal com 213 emissões para 66 alunos", async () => {
    const alunosArr = [];
    const valoresArr = [];
    const motivosArr = [];
    const expectedBalances = new Map();

    for (const aluno of simulacao.alunos) {
      const studentAddr = getStudentWallet(aluno.matricula);
      expectedBalances.set(studentAddr, BigInt(aluno.total_wc));

      for (const item of aluno.itens) {
        alunosArr.push(studentAddr);
        valoresArr.push(item.valor);
        motivosArr.push(ethers.encodeBytes32String(item.motivo));
      }
    }

    expect(alunosArr.length).to.equal(simulacao.total_emissoes);

    // Executa a transação atômica em lote
    const tx = await wc.connect(minter).mintRewardBatch(alunosArr, valoresArr, motivosArr);
    const receipt = await tx.wait();

    // Valida consumo de gas razoável (< 3.000.000)
    expect(receipt.gasUsed).to.be.lessThan(3000000n);

    // Valida saldo de todos os 66 alunos
    for (const [studentAddr, expectedBalance] of expectedBalances.entries()) {
      const balance = await wc.balanceOf(studentAddr);
      expect(balance).to.equal(expectedBalance);
    }

    // Valida totalSupply total distribuído
    expect(await wc.totalSupply()).to.equal(BigInt(simulacao.total_wc_distribuido));
  });
});
