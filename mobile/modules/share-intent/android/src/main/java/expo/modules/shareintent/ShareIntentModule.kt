package expo.modules.shareintent

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ShareImageOptions : Record {
  /** `content://` da imagem — o `contentUri` do `expo-file-system`. */
  @Field val uri: String = ""
  @Field val text: String = ""
  @Field val mimeType: String = "image/png"
  /** Sem pacote: abre o seletor do sistema. */
  @Field val packageName: String? = null
  /** Atividade exata dentro do pacote — pula o "Post ou Chat?" do X. */
  @Field val className: String? = null
  @Field val chooserTitle: String? = null
}

class AppNotInstalledException :
  CodedException("ERR_APP_NOT_INSTALLED", "Target app is not installed", null)

/**
 * `ACTION_SEND` com imagem **e** texto num só intent, para um app ou
 * atividade específica.
 *
 * Existe porque nenhuma lib cobre os dois casos de uma vez: o `expo-sharing`
 * só manda arquivo (sem legenda) e o `react-native-share` sempre abre um
 * seletor para o X, que lista "Post" e "Chat" lado a lado.
 *
 * Intent explícito não precisa de `<queries>` (visibilidade de pacotes só
 * afeta consulta, não `startActivity`): se o app não existe, cai no
 * `ActivityNotFoundException` e o JS decide o fallback.
 */
class ShareIntentModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareIntent")

    AsyncFunction("shareImage") { options: ShareImageOptions ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val content = Uri.parse(options.uri)

      val send = Intent(Intent.ACTION_SEND).apply {
        type = options.mimeType
        putExtra(Intent.EXTRA_STREAM, content)
        putExtra(Intent.EXTRA_TEXT, options.text)
        // O `ClipData` é o que faz a permissão de leitura chegar ao app
        // destino também quando o intent passa pelo seletor.
        clipData = ClipData.newRawUri(null, content)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val pkg = options.packageName
        val cls = options.className
        if (pkg != null && cls != null) setClassName(pkg, cls)
        else if (pkg != null) setPackage(pkg)
      }

      val intent =
        if (options.packageName == null) Intent.createChooser(send, options.chooserTitle)
        else send

      try {
        activity.startActivity(intent)
      } catch (e: ActivityNotFoundException) {
        throw AppNotInstalledException()
      }
    }.runOnQueue(Queues.MAIN)
  }
}
