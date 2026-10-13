import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNotificationPreferences,showNotification,notificationPreferenceKey} from '../lib/notification-preferences.ts';
test('invalid or missing local preferences preserve all notifications',()=>{for(const raw of [null,'broken','{}','null'])assert.deepEqual(parseNotificationPreferences(raw),{bulletins:true,completed:true});});
test('optional notification filters never hide pending work or alter account scope',()=>{
 const off=parseNotificationPreferences('{"bulletins":false,"completed":false}');
 assert.equal(showNotification({category:'bulletin',pending:true},off),false);
 assert.equal(showNotification({category:'count',pending:false},off),false);
 assert.equal(showNotification({category:'contract',pending:true},off),true);
 assert.notEqual(notificationPreferenceKey('a','s'),notificationPreferenceKey('b','s'));
 assert.notEqual(notificationPreferenceKey('a','s'),notificationPreferenceKey('a','t'));
});
