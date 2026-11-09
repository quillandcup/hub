-- Contract step of 20270531000000: drop the four-argument chat_post_shared_video. It was kept while the code live at the time still
-- called it; the app now calls only the five-argument form (with the thread root, null for a top-level message).
set lock_timeout = '5s';

-- Approved ban-drop-function ignore: the last call to the four-argument form was removed in #1139, which is deployed.
-- squawk-ignore ban-drop-function
DROP FUNCTION public.chat_post_shared_video(text, text, text, boolean);

NOTIFY pgrst, 'reload schema';
