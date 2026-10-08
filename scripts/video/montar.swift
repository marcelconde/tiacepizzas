// Monta o vídeo-tutorial a partir do que o gravador deixou em uma pasta:
//   manifesto.json (quadros com o instante de cada um, legendas e duração) + quadros JPEG + narração (m4a).
// Uso: swift -swift-version 5 montar.swift <pasta> <saida.mp4>
// Só usa o que já vem no macOS (AVFoundation); não precisa de ffmpeg.
import AVFoundation
import AppKit

struct Quadro: Decodable { let t: Double; let arquivo: String }
struct Legenda: Decodable { let inicio: Double; let fim: Double; let texto: String }
struct Manifesto: Decodable {
  let largura: Int; let altura: Int; let faixa: Int; let duracao: Double
  let quadros: [Quadro]; let legendas: [Legenda]; let audio: String?
}

let args = CommandLine.arguments
guard args.count >= 3 else { print("uso: montar.swift <pasta> <saida.mp4>"); exit(64) }
let pasta = URL(fileURLWithPath: args[1], isDirectory: true)
let saida = URL(fileURLWithPath: args[2])
let m = try JSONDecoder().decode(Manifesto.self, from: Data(contentsOf: pasta.appendingPathComponent("manifesto.json")))
let W = m.largura, H = m.altura, FAIXA = m.faixa
let semSom = pasta.appendingPathComponent("sem-som.mp4")
try? FileManager.default.removeItem(at: semSom)
try? FileManager.default.removeItem(at: saida)

let writer = try AVAssetWriter(outputURL: semSom, fileType: .mp4)
let entrada = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 1_000_000, AVVideoMaxKeyFrameIntervalDurationKey: 8,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoExpectedSourceFrameRateKey: 12,
  ] as [String: Any],
])
entrada.expectsMediaDataInRealTime = false
let adaptador = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: entrada, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
writer.add(entrada)
guard writer.startWriting() else { print("não consegui iniciar: \(String(describing: writer.error))"); exit(1) }
writer.startSession(atSourceTime: .zero)

let cores = CGColorSpace(name: CGColorSpace.sRGB)!
let fundo = CGColor(red: 0.149, green: 0.098, blue: 0.071, alpha: 1)       // #261912, a cor da capa do manual
let creme = NSColor(red: 0.992, green: 0.980, blue: 0.961, alpha: 1)
let paragrafo = NSMutableParagraphStyle(); paragrafo.alignment = .center; paragrafo.lineBreakMode = .byWordWrapping
let fonte = NSFont.systemFont(ofSize: CGFloat(FAIXA) * 0.30, weight: .medium)
let atributos: [NSAttributedString.Key: Any] = [.font: fonte, .foregroundColor: creme, .paragraphStyle: paragrafo]

var imagemAtual: CGImage? = nil
var arquivoAtual = ""
func carregar(_ arquivo: String) {
  if arquivo == arquivoAtual { return }
  guard let fonteImg = CGImageSourceCreateWithURL(pasta.appendingPathComponent(arquivo) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(fonteImg, 0, nil) else { return }
  imagemAtual = img; arquivoAtual = arquivo
}
func legendaEm(_ t: Double) -> String? { m.legendas.last(where: { t >= $0.inicio - 0.001 && t < $0.fim })?.texto }

func escrever(_ t: Double) {
  while !entrada.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
  var pb: CVPixelBuffer? = nil
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptador.pixelBufferPool!, &pb)
  guard let buffer = pb else { return }
  CVPixelBufferLockBaseAddress(buffer, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: W, height: H, bitsPerComponent: 8,
                      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: cores,
                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  ctx.setFillColor(fundo); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
  if let img = imagemAtual {
    // a tela gravada ocupa a área acima da faixa de legenda, inteira e sem distorcer (celular fica centralizado)
    let area = CGRect(x: 0, y: FAIXA, width: W, height: H - FAIXA)
    let escala = min(area.width / CGFloat(img.width), area.height / CGFloat(img.height))
    let w = CGFloat(img.width) * escala, h = CGFloat(img.height) * escala
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: area.midX - w / 2, y: area.midY - h / 2, width: w, height: h))
  }
  if let texto = legendaEm(t) {
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
    let frase = NSAttributedString(string: texto, attributes: atributos)
    let margem = CGFloat(W) * 0.05
    let caixa = frase.boundingRect(with: CGSize(width: CGFloat(W) - 2 * margem, height: CGFloat(FAIXA)), options: [.usesLineFragmentOrigin])
    frase.draw(with: CGRect(x: margem, y: (CGFloat(FAIXA) - caixa.height) / 2, width: CGFloat(W) - 2 * margem, height: caixa.height), options: [.usesLineFragmentOrigin])
    NSGraphicsContext.restoreGraphicsState()
  }
  CVPixelBufferUnlockBaseAddress(buffer, [])
  adaptador.append(buffer, withPresentationTime: CMTime(seconds: t, preferredTimescale: 600))
}

// instantes em que a imagem ou a legenda mudam, mais um quadro repetido a cada meio segundo de tela parada
var instantes = Set<Int>()
for q in m.quadros { instantes.insert(Int((q.t * 1000).rounded())) }
for l in m.legendas { instantes.insert(Int((l.inicio * 1000).rounded())); instantes.insert(Int((l.fim * 1000).rounded())) }
var ms = 0
while Double(ms) / 1000 < m.duracao { instantes.insert(ms); ms += 500 }
let ordenados = instantes.filter { Double($0) / 1000 < m.duracao }.sorted()
var iq = 0, ultimo = -1
for (n, instante) in ordenados.enumerated() {
  if instante - ultimo < 30 && ultimo >= 0 { continue }   // no máximo ~33 quadros por segundo
  let t = Double(instante) / 1000
  while iq + 1 < m.quadros.count && m.quadros[iq + 1].t <= t + 0.0005 { iq += 1 }
  if !m.quadros.isEmpty { carregar(m.quadros[iq].arquivo) }
  autoreleasepool { escrever(t) }
  ultimo = instante
  if n % 600 == 0 { print(String(format: "  %.0f%%", 100 * t / m.duracao)) }
}
entrada.markAsFinished()
writer.endSession(atSourceTime: CMTime(seconds: m.duracao, preferredTimescale: 600))
let fim = DispatchSemaphore(value: 0)
writer.finishWriting { fim.signal() }
fim.wait()
guard writer.status == .completed else { print("falha ao escrever o vídeo: \(String(describing: writer.error))"); exit(1) }

// junta a narração sem recodificar o vídeo
guard let nomeAudio = m.audio else { try FileManager.default.moveItem(at: semSom, to: saida); print("vídeo sem narração: \(saida.path)"); exit(0) }
let video = AVURLAsset(url: semSom), audio = AVURLAsset(url: pasta.appendingPathComponent(nomeAudio))
let comp = AVMutableComposition()
let trilhaV = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
try trilhaV.insertTimeRange(CMTimeRange(start: .zero, duration: video.duration), of: video.tracks(withMediaType: .video)[0], at: .zero)
if let origem = audio.tracks(withMediaType: .audio).first {
  let trilhaA = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
  try trilhaA.insertTimeRange(CMTimeRange(start: .zero, duration: CMTimeMinimum(audio.duration, video.duration)), of: origem, at: .zero)
}
let exportar = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough)!
exportar.outputURL = saida; exportar.outputFileType = .mp4; exportar.shouldOptimizeForNetworkUse = true
let fim2 = DispatchSemaphore(value: 0)
exportar.exportAsynchronously { fim2.signal() }
fim2.wait()
guard exportar.status == .completed else { print("falha ao juntar a narração: \(String(describing: exportar.error))"); exit(1) }
try? FileManager.default.removeItem(at: semSom)
let tamanho = (try? FileManager.default.attributesOfItem(atPath: saida.path)[.size] as? Int) ?? 0
print(String(format: "vídeo pronto: %@ (%.1f min, %.1f MB)", saida.path, m.duracao / 60, Double(tamanho ?? 0) / 1_048_576))
