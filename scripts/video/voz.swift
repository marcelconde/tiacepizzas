// Servidor de voz do vídeo-tutorial: sintetiza as falas com uma voz do sistema — por padrão a voz neural
// da Siri, bem mais natural que as do comando "say" — e grava cada uma em um arquivo de áudio.
//
// Roda pelo interpretador (swift voz.swift <identificador da voz> [velocidade]) de propósito: só processos da
// Apple enxergam as vozes da Siri; um binário compilado por nós não as vê.
//
// Protocolo, uma linha por pedido:  entrada {"texto": "...", "saida": "/caminho.caf"}  →  saída "ok <quadros>" ou "erro <motivo>"
import AVFoundation

let a = CommandLine.arguments
setvbuf(stdout, nil, _IOLBF, 0)
guard a.count >= 2, let voz = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.identifier == a[1] }) else {
  print("sem-voz")
  exit(2)
}
let velocidade = a.count > 2 ? Float(a[2]) ?? AVSpeechUtteranceDefaultSpeechRate : AVSpeechUtteranceDefaultSpeechRate
print("pronto \(voz.name)")

struct Pedido: Decodable { let texto: String; let saida: String }
let sintetizador = AVSpeechSynthesizer()

func falar(_ p: Pedido, _ fim: @escaping (String) -> Void) {
  let fala = AVSpeechUtterance(string: p.texto)
  fala.voice = voz
  fala.rate = velocidade
  var arquivo: AVAudioFile? = nil
  var quadros = 0
  var acabou = false
  sintetizador.write(fala) { buffer in
    guard !acabou, let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 { // fim da fala
      acabou = true
      arquivo = nil // fecha o arquivo
      fim(quadros > 0 ? "ok \(quadros)" : "erro vazio")
      return
    }
    if arquivo == nil {
      arquivo = try? AVAudioFile(forWriting: URL(fileURLWithPath: p.saida), settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
    }
    try? arquivo?.write(from: pcm)
    quadros += Int(pcm.frameLength)
  }
}

Thread.detachNewThread {
  while let linha = readLine() {
    guard let dados = linha.data(using: .utf8), let pedido = try? JSONDecoder().decode(Pedido.self, from: dados) else {
      print("erro pedido inválido")
      continue
    }
    let espera = DispatchSemaphore(value: 0)
    var resposta = ""
    DispatchQueue.main.async { falar(pedido) { r in resposta = r; espera.signal() } }
    if espera.wait(timeout: .now() + 90) == .timedOut { resposta = "erro tempo esgotado" }
    print(resposta)
  }
  exit(0)
}
RunLoop.main.run()
