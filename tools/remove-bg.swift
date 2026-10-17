// Removes the background from character images using macOS Vision.
// Usage: swift tools/remove-bg.swift <input-dir> <output-dir>
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 else {
    print("usage: remove-bg.swift <input-dir> <output-dir>")
    exit(1)
}
let inDir = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let ctx = CIContext()
let files = try FileManager.default.contentsOfDirectory(at: inDir, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "png" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }

for file in files {
    guard let src = CGImageSourceCreateWithURL(file as CFURL, nil),
          let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        print("skip (unreadable): \(file.lastPathComponent)")
        continue
    }
    let handler = VNImageRequestHandler(cgImage: cg)
    let request = VNGenerateForegroundInstanceMaskRequest()
    do {
        try handler.perform([request])
        guard let result = request.results?.first else {
            print("skip (no subject): \(file.lastPathComponent)")
            continue
        }
        let buffer = try result.generateMaskedImage(
            ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
        let ci = CIImage(cvPixelBuffer: buffer)
        guard let outCG = ctx.createCGImage(ci, from: ci.extent) else { continue }
        let outURL = outDir.appendingPathComponent(file.lastPathComponent)
        guard let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
        CGImageDestinationAddImage(dest, outCG, nil)
        CGImageDestinationFinalize(dest)
        print("ok: \(file.lastPathComponent) instances=\(result.allInstances.count)")
    } catch {
        print("fail: \(file.lastPathComponent) \(error)")
    }
}
