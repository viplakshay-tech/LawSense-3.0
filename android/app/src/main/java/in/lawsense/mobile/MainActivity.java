package in.lawsense.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeGuideAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
